// 튜토리얼 1: Hello World - 보내는 쪽
import amqp from 'amqplib';

const queue = 'tut_hello';
const conn = await amqp.connect('amqp://guest:guest@localhost:5672');
const ch = await conn.createChannel();
await ch.assertQueue(queue, { durable: true });

ch.sendToQueue(queue, Buffer.from('Hello World!'), { persistent: true });
console.log('[보냄] Hello World!');

await ch.close();
await conn.close();
