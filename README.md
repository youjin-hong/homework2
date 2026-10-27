# 이벤트 드리븐 실습: Master 1개 + Worker 3개 작업 분산

Docker 없이 맥북에서 Master 1개와 Worker 3개를 독립 프로세스로 띄우고, RabbitMQ로 작업을 나눠 처리한다.
화면에서 작업을 요청하면 Master가 `jobs` 큐에 넣고, Worker 하나가 처리한 뒤 결과를 `job.events` 큐로 돌려보내고, Master가 DB를 갱신한다. 코드 이름은 `job`, `worker`, `master`다.

## 구성

```
브라우저 ─▶ nginx(8088) ─▶ Master(3001) ─▶ RabbitMQ jobs 큐 ─▶ Worker 1·2·3
                              ▲  │                                  │
                              │  ▼                                  ▼
                            MySQL(3306)          RabbitMQ job.events 큐 (Worker → Master)
```

작업 하나의 경로는 아래와 같다.

```
[요청] 프론트 → nginx → Master →(DB 기록)→ jobs 큐 → Worker
[결과] Worker → job.events 큐 → Master →(DB 갱신)
[확인] 프론트 →(1초마다, nginx 경유)→ Master → DB   (Master가 프론트로 보내는 것이 아니라 프론트가 물어본다)
```

| 요소 | 하는 일 |
| --- | --- |
| React (프론트) | 작업 요청 버튼, 1초 Polling으로 상태 조회 |
| nginx | 화면 파일 제공, `/api/`를 Master로 전달 |
| Master | 작업을 DB에 기록하고 `jobs` 큐에 발행(Producer), 결과 이벤트를 받아 DB 갱신(Consumer) |
| Worker | `jobs` 큐에서 작업을 받아 처리(Consumer), 결과를 `job.events` 큐에 발행(Producer) |
| RabbitMQ | 메시지 브로커. `jobs`, `job.events` 큐 보관 |
| MySQL | 작업 상태 저장소. Master만 읽고 쓴다 |
| 수동 Ack | Worker가 결과 이벤트 전달을 확인한 뒤에만 보내는 처리 완료 신호 |
| `prefetch=1` | Worker는 한 번에 작업 하나만 가져간다 |

### 용어 정리

- **메시지와 이벤트:** 메시지는 큐를 오가는 데이터 봉투 전체이고, 이벤트는 그중 "어떤 일이 일어났다"는 사실을 알리는 것이다. `jobs` 큐의 메시지는 Master가 Worker에게 보내는 **요청**("이 작업을 처리해 줘")이고, `job.events` 큐의 메시지(`job.started`, `job.completed`, `job.failed`)가 Worker가 보내는 **이벤트**("처리가 끝났다")다. 이벤트는 과거형으로 이름 짓고, 어떻게 반응할지는 받는 쪽이 정한다. `job.created`는 Master가 자기가 만든 작업이라 큐로 보내지 않고 DB에만 기록한다.
- **Producer와 Consumer:** 프로그램 이름이 아니라 큐를 기준으로 한 역할이다. Master와 Worker는 둘 다 Producer이면서 Consumer다.
- **수동 Ack와 재전달:** Worker가 메시지를 받아도 RabbitMQ는 지우지 않고 "전달됨, 확인 전(Unacked)"으로만 표시한다. Ack를 받아야 지운다. Worker가 Ack 전에 죽으면 RabbitMQ가 연결이 끊긴 것을 알고(프로세스가 죽으면 운영체제가 TCP 연결을 대신 닫는다) 그 메시지를 `jobs` 큐로 되돌리며 `redelivered: true`가 붙는다. 네트워크가 끊기거나 기계가 멈춘 경우는 하트비트로 알아채는데, 한 대에서 하는 이번 실습에는 해당하지 않는다.
- **`prefetch`:** Ack 없이 Worker가 한 번에 쥐고 있을 수 있는 메시지 수다. 1이면 처리 중인 것 하나만, 2이면 미리 받아 둔 것 하나를 더 쥔다. 올릴수록 짧은 작업의 처리량은 늘지만, 미리 받은 작업이 그 Worker 안에서 기다려 다른 Worker가 놀아도 가져가지 못한다. 처리 시간이 긴 이번 작업에는 공평하게 나뉘는 `1`이 맞다.
- **`durable`과 `persistent`:** durable은 **큐**를 디스크에 기록해 재시작 후에도 남기고(`assertQueue`의 `durable: true`), persistent는 **메시지**를 디스크에 기록한다(`sendToQueue`의 `persistent: true`). 둘을 같이 해야 RabbitMQ를 재시작해도 큐와 메시지가 남는다(테스트 H). 디스크는 맥북 내장 SSD이고 DB와는 다르다. RabbitMQ는 Ack하면 메시지를 지우고, MySQL은 작업 기록을 계속 보관한다.

작업 종류는 코드에 고정했다. 작업 A 6초 · 작업 B 10초 · 작업 C 15초(`server/shared.js`의 `JOB_TYPES`). 처리 시간은 `setTimeout`으로 흉내 낸 것이다. (처음에는 3초·5초·10초였고, 화면에서 흐름이 보이도록 늘렸다. 아래 테스트 결과는 처음 시간으로 측정했다.)

화면은 위 경로를 그대로 펼친 **파이프라인**(`web/src/Pipeline.tsx`)이다. 작업 하나가 토큰이 되어 지나가는 자리가 강조되고 Motion의 `layoutId`로 칸 사이를 이동한다.

- **실제 상태를 따르는 구간:** `jobs` 큐 대기(`queued`), Worker 처리 중(`started`와 `workerId`)
- **화면에서 연출한 구간:** 프론트 → nginx → Master, `job.events` 큐 → Master → DB → 프론트. 순식간이라 보이지 않아서, 요청 직후와 끝났다는 것을 프론트가 알게 된 직후에 차례로 점등한다(`web/src/flights.ts`).
- **장애 내기** 버튼은 테스트 E(수동 Ack)를 화면에서 해 보는 버튼이다. 누르면 Master가 `worker.control.<workerId>` 큐에 명령을 보내고, Worker가 Ack 없이 연결을 끊어 처리 중이던 작업이 다른 Worker에게 `redelivered`로 넘어간다. 장애가 난 Worker는 10초 뒤 스스로 돌아온다(중단됨 표시는 화면에서만 계산한다).
- 화면 이름은 `web/src/names.ts`에서만 붙였다(`worker-1` → Worker 1). 코드와 `WORKER_ID`는 그대로다.

| 프로세스 | 하는 일 |
| --- | --- |
| `server/master.js` | API, 결과 큐 소비, DB 기록. DB는 Master만 쓴다 |
| `server/worker.js` | 작업 큐 소비, 한 번에 한 건 처리, 이벤트 발행 (HTTP 서버 아님) |
| `server/shared.js` | 큐 이름, 큐 옵션, 이벤트 이름, 작업 종류, confirm 발행 헬퍼 |
| `server/schema.sql` | MySQL 테이블 2개 (`jobs`, `job_events`) |
| `web/` | Vite + React 파이프라인 화면과 작업 목록 표 (Motion) |
| `nginx/homework2.conf` | 화면 제공, `/api/`를 Master로 전달 |

## 설치 (맥북, Apple Silicon 기준)

```bash
brew install rabbitmq nginx mysql
brew services start rabbitmq
brew services start mysql
```

DB와 계정을 만든다. 접속 정보는 `server/.env`에 둔다(`.gitignore`에 포함).

```sql
CREATE DATABASE homework2 CHARACTER SET utf8mb4;
CREATE USER 'hw2'@'localhost' IDENTIFIED BY '<비밀번호>';
GRANT ALL ON homework2.* TO 'hw2'@'localhost';
```

```bash
# server/.env
PORT=3001
DB_HOST=127.0.0.1
DB_USER=hw2
DB_PASSWORD=<비밀번호>
DB_NAME=homework2
AMQP_URL=amqp://guest:guest@localhost:5672
```

```bash
cd server && npm i && mysql -u hw2 -p homework2 < schema.sql
cd ../web && npm i && npm run build
ln -sf ~/dev/homework2/nginx/homework2.conf /opt/homebrew/etc/nginx/servers/homework2.conf
nginx -t && brew services start nginx
```

이 맥에서는 OrbStack이 3000번과 8080번을 쓰고 있어서 두 군데를 바꿨다.

- Master 포트를 3000 대신 **3001**로 했다 (`server/.env`, `web/vite.config.ts`, `nginx/homework2.conf`).
- Homebrew nginx의 기본 server가 8080에서 시작하지 못해서, `/opt/homebrew/etc/nginx/nginx.conf`의 기본 포트를 **8089**로 바꿨다 (원본은 `nginx.conf.bak`).

## 실행 순서

1. `brew services start rabbitmq` (MySQL, nginx도 서비스로 켜 둔다)
2. 터미널 1: `cd server && node --env-file=.env --watch master.js`
3. 터미널 2~4: `WORKER_ID=worker-1 node --env-file=.env --watch worker.js` (2, 3도 같은 방식)
4. 개발 중: `cd web && npm run dev` → http://localhost:5173
5. 완성 후: `cd web && npm run build` → http://localhost:8088

RabbitMQ 관리 화면은 http://localhost:15672 (guest / guest)이다. Master와 Worker는 RabbitMQ 연결이 끊기면 스스로 종료하며, 자동 재연결은 만들지 않았다.

## 메시지와 처리 순서

```json
// jobs 큐
{ "jobId": 15, "type": "B", "durationMs": 10000, "shouldFail": false }

// job.events 큐 (event = job.started / job.completed / job.failed)
{ "event": "job.completed", "jobId": 15, "status": "completed",
  "workerId": "worker-2", "message": "처리 완료 (10.0초)", "occurredAt": "..." }
```

- `POST /api/jobs`(`{ "type": "A", "shouldFail": false }`)는 DB에 `queued`로 저장한 뒤 confirm 채널로 `jobs` 큐에 발행하고, 확인되면 `{ jobId, status: "queued" }`로 응답한다. 발행에 실패하면 해당 작업을 `failed`로 바꾸고 503을 돌려주도록 했다.
- Worker는 `job.started`를 발행하고 처리한 뒤, confirm 채널로 `job.completed` 또는 `job.failed`를 발행해 브로커의 확인을 받고 **그다음에** 원래 작업 메시지에 Ack한다.
- 실패해도 Ack한다. `nack(requeue=true)`를 하면 같은 작업이 끝없이 돌아오기 때문이다. 실무에서는 Dead Letter Queue로 보내 따로 모은다.
- Master는 이벤트를 `job_events`에 쌓고(중복도 그대로 기록), `jobs` 상태는 조건부 UPDATE 한 줄로 바꾼다. 이미 `completed`/`failed`인 작업은 되돌리지 않는다.

```sql
UPDATE jobs SET status = ?, worker_id = ?, result_message = ?, updated_at = NOW(3)
WHERE id = ? AND status NOT IN ('completed', 'failed');
```

`job_events`는 한 줄씩 추가만 하는 로그이고 `jobs`는 그 결과를 반영한 현재 상태다. 완전한 이벤트 소싱은 아니다.

## 통합 테스트 결과

2026-10-28에 직접 실행한 결과다. 당시에는 작업 종류의 이름과 시간이 지금과 달랐다(작업 A 3초, 작업 B 5초, 작업 C 10초에 해당).

| # | 시나리오 | 결과 |
| --- | --- | --- |
| A | 작업 1번 요청 | Worker 하나가 처리해 `completed` |
| B | 작업 A 9번 연속 | worker-1·2·3이 3개씩 나눠 처리 |
| C | Worker 3개를 켜 두고, 작업 C·A·A를 3번 반복 요청 | prefetch 끔: **31초**, 작업 C 3개가 worker-1에 몰림. prefetch=1: **19초**, 세 Worker에 하나씩 |
| D | Worker를 모두 끄고 5번 요청 | 5건 모두 `queued`, 큐 Ready=5. Worker 1개를 켜자 차례로 처리, 나머지를 켜자 나눠 처리 |
| E | 작업 C 처리 중인 Worker를 `kill -9` | 다른 Worker가 같은 jobId를 `redelivered: true`로 받아 완료. 이벤트 로그에 `job.started`가 두 번 남음 |
| F | 실패시키기 체크 후 요청 | `failed`, Worker가 시작한 횟수 1번 (재시도 없음) |
| G | 처리 중에 Master를 끄고 Worker가 끝낸 뒤 재시작 | 꺼진 동안 요청은 502. DB는 `started`였다가 재시작 후 `completed`로 갱신 |
| H | D 상태에서 `brew services restart rabbitmq` | 재시작 후에도 Ready=5 유지 |

### 검증하지 못한 것

- 재전달된 `job.started`가 이미 끝난 작업을 되돌리지 못하게 막는 장면 (조건부 UPDATE의 효과). 테스트 E에서는 완료 이벤트가 나오기 전에 Worker가 죽어서 재현되지 않았다.
- 발행 실패 시 503 응답. 테스트 G의 502는 Master가 꺼져서 nginx가 낸 응답이고, Master가 낸 503은 시험하지 않았다.
- Master와 Worker를 `pgrep`으로 확인한 독립 프로세스 4개와 관리 화면의 Connections=4.
- 화면의 **장애 내기** 버튼으로 Worker가 복귀한 뒤 다시 작업을 받는지.

### 테스트 C에서 배운 것

처음에는 Worker가 메시지를 받는 즉시 동시에 `await sleep`을 걸었다. 그러면 prefetch를 꺼도 한 Worker가 작업 C 3개를 동시에 처리해서 오히려 10초로 더 빨리 끝났다(prefetch=1은 20초). Worker는 한 번에 한 건만 처리해야 하므로 줄을 세워 하나씩 처리하도록 고쳤고, 그 뒤에 위 표의 31초 대 19초가 나왔다. prefetch의 효과는 **소비자가 한 번에 하나만 처리할 때** 보인다.

## 생각해 볼 점

### Master가 2개라면?

1. **왜 고민했나:** 테스트 G에서 Master가 꺼진 동안 요청을 받지 못했다. Master가 단일 장애점이다.
2. **방법 두 가지:** 대기형(active-standby)과 둘 다 일하기(active-active).
3. **둘 다 일할 때 생기는 문제와 지금 설계가 이미 해결한 것:**
   - 상태 공유: 상태를 DB에만 두므로 해결된다.
   - 작업 번호 중복: DB가 번호를 매기므로 해결된다.
   - 결과 이벤트가 다른 Master로 감: 공유 DB와 Polling을 쓰므로 문제없다.
   - 두 Master가 같은 작업의 이벤트를 동시에 처리: 상태 갱신이 조건부 UPDATE 한 줄이라 서로 덮어쓰지 않는다.
4. **그래도 바꿔야 하는 것:** nginx `upstream` 설정, `PORT`만 다르게 해서 `master.js`를 2번 실행. MySQL은 서버 DB라 두 Master가 같은 DB를 그대로 공유할 수 있다.
5. **1+3을 고른 이유:** 이 앱의 병목은 작업 처리(Worker)라서 늘린다면 Worker를 늘리는 게 맞다. 2+2는 요청은 빨리 받지만 처리가 밀린다. 그리고 과제 조건이 1+3이다.
6. **더 생각할 거리:** SSE로 바꾸면 사용자와 연결된 Master와 알림을 받은 Master가 다를 수 있다. 그러면 모든 Master가 이벤트를 받는 fanout 구조가 필요하다 (공식 튜토리얼 3번 Pub/Sub).

### 같은 작업이 두 번 처리될 수 있다

테스트 E처럼 Worker가 Ack 전에 죽으면 다른 Worker가 같은 작업을 다시 처리한다. 완료 이벤트까지 보낸 뒤 죽었다면 완료 이벤트가 두 번 온다. Master는 "이미 끝난 작업의 상태는 바꾸지 않는다"는 조건을 UPDATE에 넣어 결과를 망가뜨리지 않는다(멱등성). 다만 처리 자체는 두 번 일어났다. 결제나 발송처럼 두 번 하면 안 되는 작업이라면 Worker 쪽에서도 jobId로 중복을 걸러야 한다.

### 실패한 작업은 그냥 버려진다

지금은 실패해도 Ack하고 끝낸다. 실무에서는 Dead Letter Queue로 보내 나중에 원인을 보거나 다시 처리한다.

### Worker가 죽은 걸 Master가 모른다

RabbitMQ는 Worker와의 TCP 연결이 끊긴 것으로 죽음을 알고 Ack 안 된 작업을 `jobs` 큐로 되돌린다. 하지만 Master는 Worker가 보낸 이벤트로만 Worker를 알기 때문에, 죽은 Worker는 이벤트를 보내지 못해 화면과 DB는 다른 Worker가 `job.started`를 보낼 때까지 그대로다. 해결하려면 Worker가 주기적으로 "살아 있음" 신호(heartbeat)를 Master에게 보내야 한다. 화면의 장애 내기 표시도 버튼을 누른 화면이 혼자 계산한 것이다.

### Master가 DB 갱신 전에 죽으면?

Master는 DB 갱신이 끝난 **뒤에** 이벤트를 Ack한다. 갱신 중에 죽으면 이벤트가 큐에 남아 재시작 후 다시 처리된다. `job_events`에는 같은 이벤트가 두 줄 남을 수 있지만, `jobs` 상태는 조건부 UPDATE라 영향이 없다.
