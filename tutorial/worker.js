// 튜토리얼 2: Work Queues - 워커
// 사용법: WORKER_ID=w1 node worker.js
// PREFETCH=0 으로 실행하면 prefetch를 끈다 (비교 실험용)
import amqp from 'amqplib';

const queue = 'tut_task_queue';
const id = process.env.WORKER_ID || 'worker';
const prefetch = Number(process.env.PREFETCH ?? 1);

const conn = await amqp.connect('amqp://guest:guest@localhost:5672');
const ch = await conn.createChannel();
await ch.assertQueue(queue, { durable: true });
if (prefetch > 0) ch.prefetch(prefetch);

console.log(`[${id}] 대기 중 (prefetch=${prefetch})`);
ch.consume(queue, async (msg) => {
  const text = msg.content.toString();
  const seconds = text.split('.').length - 1;
  console.log(`[${id}] 시작: ${text} (${seconds}초, redelivered: ${msg.fields.redelivered})`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  console.log(`[${id}] 끝: ${text}`);
  ch.ack(msg);
});
