// 튜토리얼 1: Hello World - 받는 쪽 (Ctrl+C로 종료)
import amqp from 'amqplib';

const queue = 'tut_hello';
const conn = await amqp.connect('amqp://guest:guest@localhost:5672');
const ch = await conn.createChannel();
await ch.assertQueue(queue, { durable: true });

console.log('[대기] 메시지를 기다리는 중...');
ch.consume(queue, (msg) => {
  console.log('[받음]', msg.content.toString());
}, { noAck: true });
