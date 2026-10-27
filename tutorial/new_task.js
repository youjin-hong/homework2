// 튜토리얼 2: Work Queues - 작업 보내기
// 사용법: node new_task.js 작업내용...   (점 하나 = 1초)
import amqp from 'amqplib';

const queue = 'tut_task_queue';
const text = process.argv.slice(2).join(' ') || 'Hello World!';
const conn = await amqp.connect('amqp://guest:guest@localhost:5672');
const ch = await conn.createChannel();
await ch.assertQueue(queue, { durable: true });

ch.sendToQueue(queue, Buffer.from(text), { persistent: true });
console.log('[보냄]', text);

await ch.close();
await conn.close();
