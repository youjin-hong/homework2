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

// 작업 종류별 처리 시간 (ms)
export const JOB_TYPES = {
  A: 6000,
  B: 10000,
  C: 15000,
};

export const WORKER_IDS = ['worker-1', 'worker-2', 'worker-3'];

// 화면의 장애 내기 버튼이 보내는 명령 큐 (워커마다 하나)
export const controlQueue = (workerId) => `worker.control.${workerId}`;

// 장애가 난 워커가 복귀하기까지의 시간
export const WORKER_RECOVER_MS = 10000;

// confirm 채널에서 브로커가 받았다는 확인까지 기다린다
export function publishConfirmed(channel, queue, payload, options = {}) {
  return new Promise((resolve, reject) => {
    channel.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), { persistent: true, ...options }, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}
