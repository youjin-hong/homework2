export const AMQP_URL = process.env.AMQP_URL ?? 'amqp://guest:guest@localhost:5672';

export const QUEUES = {
  JOBS: 'jobs',
  EVENTS: 'job.events',
};

// 마스터·워커가 같은 옵션으로 선언해야 PRECONDITION_FAILED가 안 난다
export const QUEUE_OPTIONS = { durable: true };

export const EVENTS = {
  STARTED: 'job.started',
  COMPLETED: 'job.completed',
  FAILED: 'job.failed',
};

export const MENUS = {
  라면: 3000,
  돈까스: 5000,
  김치볶음밥: 10000,
};

// confirm 채널에서 브로커가 받았다는 확인까지 기다린다
export function publishConfirmed(channel, queue, payload) {
  return new Promise((resolve, reject) => {
    channel.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), { persistent: true }, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}
