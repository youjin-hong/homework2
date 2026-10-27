import amqp from 'amqplib';
import { AMQP_URL, QUEUES, QUEUE_OPTIONS, EVENTS, publishConfirmed } from './shared.js';

const workerId = process.env.WORKER_ID ?? 'worker-1';
// PREFETCH=0 이면 prefetch 끔 (테스트 C용)
const prefetch = Number(process.env.PREFETCH ?? 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const conn = await amqp.connect(AMQP_URL);
conn.on('error', (err) => console.error(`[${workerId}] 연결 오류`, err.message));
conn.on('close', () => {
  console.error(`[${workerId}] RabbitMQ 연결 끊김, 종료`);
  process.exit(1);
});

const ch = await conn.createChannel();
const pubCh = await conn.createConfirmChannel();
await ch.assertQueue(QUEUES.JOBS, QUEUE_OPTIONS);
await pubCh.assertQueue(QUEUES.EVENTS, QUEUE_OPTIONS);
if (prefetch > 0) await ch.prefetch(prefetch);

const emit = (event, job, status, message) =>
  publishConfirmed(pubCh, QUEUES.EVENTS, {
    event,
    jobId: job.jobId,
    status,
    workerId,
    message,
    occurredAt: new Date().toISOString(),
  });

console.log(`[${workerId}] 대기 중 (prefetch=${prefetch})`);

// 요리사는 한 번에 한 건만 조리한다 (prefetch를 꺼도 받아 둔 메시지는 줄을 선다)
let kitchen = Promise.resolve();

await ch.consume(QUEUES.JOBS, (msg) => {
  kitchen = kitchen.then(() => cook(msg));
});

async function cook(msg) {
  const job = JSON.parse(msg.content.toString());
  console.log(`[${workerId}] job ${job.jobId} 시작 - ${job.menu} (redelivered: ${msg.fields.redelivered})`);

  try {
    await emit(EVENTS.STARTED, job, 'started', '조리 중');
    await sleep(job.durationMs);

    if (job.shouldFail) {
      await emit(EVENTS.FAILED, job, 'failed', '품절 (재료 소진)');
      console.log(`[${workerId}] job ${job.jobId} 실패`);
    } else {
      await emit(EVENTS.COMPLETED, job, 'completed', `조리 완료 (${(job.durationMs / 1000).toFixed(1)}초)`);
      console.log(`[${workerId}] job ${job.jobId} 완료`);
    }
    // 이벤트 전달이 확인된 뒤에만 Ack
    ch.ack(msg);
  } catch (err) {
    // 이벤트 발행 실패면 Ack하지 않고 재전달 대상으로 남긴다
    console.error(`[${workerId}] job ${job.jobId} 처리 실패`, err.message);
    ch.nack(msg, false, true);
  }
}
