import amqp from 'amqplib';
import express from 'express';
import mysql from 'mysql2/promise';
import {
  AMQP_URL, QUEUES, QUEUE_OPTIONS, JOB_TYPES, WORKER_IDS, WORKER_RECOVER_MS, controlQueue, publishConfirmed,
} from './shared.js';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  dateStrings: true,
});

const conn = await amqp.connect(AMQP_URL);
conn.on('error', (err) => console.error('[master] 연결 오류', err.message));
conn.on('close', () => {
  console.error('[master] RabbitMQ 연결 끊김, 종료');
  process.exit(1);
});
const pubCh = await conn.createConfirmChannel();
const subCh = await conn.createChannel();
await pubCh.assertQueue(QUEUES.JOBS, QUEUE_OPTIONS);
await subCh.assertQueue(QUEUES.EVENTS, QUEUE_OPTIONS);
for (const id of WORKER_IDS) await pubCh.assertQueue(controlQueue(id), QUEUE_OPTIONS);

// 이미 끝난 작업은 되돌리지 않는다 (재전달·중복 이벤트 대비)
async function applyEvent(e) {
  await pool.execute(
    'INSERT INTO job_events (job_id, event, worker_id, message, created_at) VALUES (?, ?, ?, ?, NOW(3))',
    [e.jobId, e.event, e.workerId, e.message],
  );
  const [res] = await pool.execute(
    `UPDATE jobs SET status = ?, worker_id = ?, result_message = ?, updated_at = NOW(3)
     WHERE id = ? AND status NOT IN ('completed', 'failed')`,
    [e.status, e.workerId, e.message, e.jobId],
  );
  return res.affectedRows;
}

await subCh.consume(QUEUES.EVENTS, async (msg) => {
  const e = JSON.parse(msg.content.toString());
  try {
    const changed = await applyEvent(e);
    console.log(`[master] ${e.event} job ${e.jobId} ${e.workerId}${changed ? '' : ' (이미 끝난 작업, 상태 유지)'}`);
    subCh.ack(msg);
  } catch (err) {
    console.error('[master] 이벤트 처리 실패', err.message);
    setTimeout(() => subCh.nack(msg, false, true), 1000);
  }
});

const JOB_COLUMNS = `id, type, status, worker_id AS workerId, result_message AS message, created_at AS createdAt`;

const app = express();
app.use(express.json());

app.post('/api/jobs', async (req, res) => {
  const { type, shouldFail = false } = req.body ?? {};
  if (!(type in JOB_TYPES)) return res.status(400).json({ error: '없는 작업 종류입니다' });
  const durationMs = JOB_TYPES[type];

  // 저장이 먼저, 발행이 나중
  const [ins] = await pool.execute(
    `INSERT INTO jobs (type, status, duration_ms, should_fail, created_at, updated_at)
     VALUES (?, 'queued', ?, ?, NOW(3), NOW(3))`,
    [type, durationMs, shouldFail ? 1 : 0],
  );
  const jobId = ins.insertId;
  await pool.execute(
    `INSERT INTO job_events (job_id, event, message, created_at) VALUES (?, 'job.created', '작업 접수', NOW(3))`,
    [jobId],
  );

  try {
    await publishConfirmed(pubCh, QUEUES.JOBS, { jobId, type, durationMs, shouldFail: Boolean(shouldFail) });
  } catch (err) {
    await pool.execute(
      `UPDATE jobs SET status = 'failed', result_message = '작업 접수 실패', updated_at = NOW(3) WHERE id = ?`,
      [jobId],
    );
    return res.status(503).json({ error: '지금은 작업을 받을 수 없습니다' });
  }
  res.status(201).json({ jobId, status: 'queued' });
});

// 워커를 직접 죽이지 않고, 워커가 읽는 명령 큐에 "장애 내기" 메시지를 보낸다
app.post('/api/workers/:id/crash', async (req, res) => {
  const workerId = req.params.id;
  if (!WORKER_IDS.includes(workerId)) return res.status(404).json({ error: '없는 워커입니다' });
  try {
    // 워커가 꺼져 있을 때 쌓인 명령이 나중에 실행되지 않도록 5초 뒤 만료
    await publishConfirmed(pubCh, controlQueue(workerId), { command: 'crash' }, { persistent: false, expiration: '5000' });
  } catch {
    return res.status(503).json({ error: '지금은 명령을 보낼 수 없습니다' });
  }
  res.json({ workerId, recoverMs: WORKER_RECOVER_MS });
});

app.get('/api/jobs', async (req, res) => {
  const [rows] = await pool.query(`SELECT ${JOB_COLUMNS} FROM jobs ORDER BY id DESC LIMIT 50`);
  res.json(rows);
});

app.get('/api/jobs/:id', async (req, res) => {
  const [jobs] = await pool.execute(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ?`, [req.params.id]);
  if (jobs.length === 0) return res.status(404).json({ error: '없는 작업입니다' });
  const [events] = await pool.execute(
    'SELECT event, worker_id AS workerId, message, created_at AS createdAt FROM job_events WHERE job_id = ? ORDER BY id',
    [req.params.id],
  );
  res.json({ ...jobs[0], events });
});

app.use((err, req, res, next) => {
  console.error('[master] 요청 처리 오류', err.message);
  res.status(500).json({ error: '서버 오류' });
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`[master] http://localhost:${port}`));
