import amqp from 'amqplib';
import {
  AMQP_URL, QUEUES, QUEUE_OPTIONS, EVENTS, WORKER_RECOVER_MS, controlQueue, publishConfirmed,
} from './shared.js';

const workerId = process.env.WORKER_ID ?? 'worker-1';
// PREFETCH=0 이면 prefetch 끔 (테스트 C용)
const prefetch = Number(process.env.PREFETCH ?? 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let epoch = 0;
let fallen = false;

async function run() {
  const myEpoch = ++epoch;
  // 쓰러진 뒤의 낡은 연결에서는 아무것도 하지 않는다
  const alive = () => epoch === myEpoch;

  const conn = await amqp.connect(AMQP_URL);
  conn.on('error', (err) => console.error(`[${workerId}] 연결 오류`, err.message));
  conn.on('close', () => {
    if (fallen) return;
    console.error(`[${workerId}] RabbitMQ 연결 끊김, 종료`);
    process.exit(1);
  });

  const ch = await conn.createChannel();
  const pubCh = await conn.createConfirmChannel();
  await ch.assertQueue(QUEUES.JOBS, QUEUE_OPTIONS);
  await pubCh.assertQueue(QUEUES.EVENTS, QUEUE_OPTIONS);
  await ch.assertQueue(controlQueue(workerId), QUEUE_OPTIONS);
  await ch.purgeQueue(controlQueue(workerId));
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

  // 요리사는 한 번에 한 건만 조리한다 (prefetch를 꺼도 받아 둔 메시지는 줄을 선다)
  let kitchen = Promise.resolve();

  async function cook(msg) {
    if (!alive()) return;
    const job = JSON.parse(msg.content.toString());
    console.log(`[${workerId}] job ${job.jobId} 시작 - ${job.menu} (redelivered: ${msg.fields.redelivered})`);

    try {
      await emit(EVENTS.STARTED, job, 'started', '조리 중');
      await sleep(job.durationMs);
      if (!alive()) return;

      if (job.shouldFail) {
        await emit(EVENTS.FAILED, job, 'failed', '품절 (재료 소진)');
        console.log(`[${workerId}] job ${job.jobId} 실패`);
      } else {
        await emit(EVENTS.COMPLETED, job, 'completed', `조리 완료 (${(job.durationMs / 1000).toFixed(1)}초)`);
        console.log(`[${workerId}] job ${job.jobId} 완료`);
      }
      // 이벤트 전달이 확인된 뒤에만 Ack
      if (alive()) ch.ack(msg);
    } catch (err) {
      if (!alive()) return;
      // 이벤트 발행 실패면 Ack하지 않고 재전달 대상으로 남긴다
      console.error(`[${workerId}] job ${job.jobId} 처리 실패`, err.message);
      ch.nack(msg, false, true);
    }
  }

  await ch.consume(QUEUES.JOBS, (msg) => {
    kitchen = kitchen.then(() => cook(msg));
  });

  // 쓰러지기: Ack 없이 연결을 끊어 조리 중이던 작업이 다른 워커에게 재전달되게 한다
  await ch.consume(controlQueue(workerId), (msg) => {
    ch.ack(msg);
    fallen = true;
    epoch++;
    console.log(`[${workerId}] 쓰러짐 (${WORKER_RECOVER_MS / 1000}초 뒤 복귀)`);
    conn.close().catch(() => {});
    setTimeout(() => {
      fallen = false;
      run().catch((err) => {
        console.error(`[${workerId}] 복귀 실패`, err.message);
        process.exit(1);
      });
    }, WORKER_RECOVER_MS);
  });

  console.log(`[${workerId}] 대기 중 (prefetch=${prefetch})`);
}

await run();
