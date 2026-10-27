# 강식당: 마스터 1개 + 워커 3개 작업 분산 실습

Docker 없이 맥북에서 마스터 1개와 워커 3개를 독립 프로세스로 띄우고, RabbitMQ로 작업을 나눠 처리한다.
손님이 주문하면 요리사가 조리하고 "주문 나왔습니다"로 끝나는 강식당을 테마로 했다. 코드 이름은 `job`, `worker`, `master` 그대로다.

## 구성

```
브라우저 ─▶ nginx(8088) ─▶ 마스터(3001) ─▶ RabbitMQ jobs 큐 ─▶ 워커 1·2·3
                              ▲  │                                  │
                              │  ▼                                  ▼
                            MySQL(3306)          RabbitMQ job.events 큐 (워커 → 마스터)
```

| 강식당 | 이번 앱 |
| --- | --- |
| 손님이 주문 | 화면에서 주문 버튼 클릭 (`POST /api/jobs`) |
| 가게 입구 안내 | nginx |
| 홀 매니저 | 마스터 |
| 주문 장부 | MySQL |
| 주문표 꽂이 | `jobs` 큐 |
| 요리사 3명 | 워커 3개 |
| "15번 주문 나왔습니다!" | `job.completed` 이벤트 (`job.events` 큐) |
| 다 쓴 주문표를 꽂이에서 빼서 버림 | Ack (홀 매니저가 아니라 꽂이에 하는 일) |
| 요리사는 주문표를 한 장씩만 집음 | `prefetch=1` |
| 재료 소진으로 품절 | `job.failed` |
| 가게 문을 닫았다 열어도 꽂이의 주문표는 그대로 | durable 큐 + persistent 메시지 |
| 주문 현황판 | React 화면 (1초 Polling) |

메뉴는 코드에 고정했다. 라면 3초 · 돈까스 5초 · 김치볶음밥 10초.

| 프로세스 | 하는 일 |
| --- | --- |
| `server/master.js` | API, 결과 큐 소비, DB 기록. DB는 마스터만 쓴다 |
| `server/worker.js` | 작업 큐 소비, 한 번에 한 건 조리, 이벤트 발행 (HTTP 서버 아님) |
| `server/shared.js` | 큐 이름, 큐 옵션, 이벤트 이름, 메뉴, confirm 발행 헬퍼 |
| `server/schema.sql` | MySQL 테이블 2개 (`jobs`, `job_events`) |
| `web/` | Vite + React 현황표 |
| `nginx/homework2.conf` | 화면 제공, `/api/`를 마스터로 전달 |

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

- 마스터 포트를 3000 대신 **3001**로 했다 (`server/.env`, `web/vite.config.ts`, `nginx/homework2.conf`).
- Homebrew nginx의 기본 server가 8080에서 시작하지 못해서, `/opt/homebrew/etc/nginx/nginx.conf`의 기본 포트를 **8089**로 바꿨다 (원본은 `nginx.conf.bak`).

## 실행 순서

1. `brew services start rabbitmq` (MySQL, nginx도 서비스로 켜 둔다)
2. 터미널 1: `cd server && node --env-file=.env --watch master.js`
3. 터미널 2~4: `WORKER_ID=worker-1 node --env-file=.env --watch worker.js` (2, 3도 같은 방식)
4. 개발 중: `cd web && npm run dev` → http://localhost:5173
5. 완성 후: `cd web && npm run build` → http://localhost:8088

RabbitMQ 관리 화면은 http://localhost:15672 (guest / guest)이다. 마스터와 워커는 RabbitMQ 연결이 끊기면 스스로 종료하며, 자동 재연결은 만들지 않았다.

## 메시지와 처리 순서

```json
// jobs 큐
{ "jobId": 15, "menu": "돈까스", "durationMs": 5000, "shouldFail": false }

// job.events 큐 (event = job.started / job.completed / job.failed)
{ "event": "job.completed", "jobId": 15, "status": "completed",
  "workerId": "worker-2", "message": "조리 완료 (5.0초)", "occurredAt": "..." }
```

- `POST /api/jobs`는 DB에 `queued`로 저장한 뒤 confirm 채널로 `jobs` 큐에 발행하고, 확인되면 `{ jobId, status: "queued" }`로 응답한다. 발행에 실패하면 해당 주문을 `failed`로 바꾸고 503을 돌려주도록 했다.
- 워커는 `job.started`를 발행하고 조리한 뒤, confirm 채널로 `job.completed` 또는 `job.failed`를 발행해 브로커의 확인을 받고 **그다음에** 원래 작업 메시지에 Ack한다.
- 실패해도 Ack한다. `nack(requeue=true)`를 하면 같은 작업이 끝없이 돌아오기 때문이다. 실무에서는 Dead Letter Queue로 보내 따로 모은다.
- 마스터는 이벤트를 `job_events`에 쌓고(중복도 그대로 기록), `jobs` 상태는 조건부 UPDATE 한 줄로 바꾼다. 이미 `completed`/`failed`인 주문은 되돌리지 않는다.

```sql
UPDATE jobs SET status = ?, worker_id = ?, result_message = ?, updated_at = NOW(3)
WHERE id = ? AND status NOT IN ('completed', 'failed');
```

`job_events`는 한 줄씩 추가만 하는 로그이고 `jobs`는 그 결과를 반영한 현재 상태다. 완전한 이벤트 소싱은 아니다.

## 통합 테스트 결과

2026-10-28에 직접 실행한 결과다.

| # | 시나리오 | 결과 |
| --- | --- | --- |
| A | 주문 1번 | 워커 하나가 처리해 `completed` |
| B | 라면 9번 연속 | worker-1·2·3이 3개씩 나눠 처리 |
| C | 워커 3개를 켜 두고, 김치볶음밥·라면·라면을 3번 반복 주문 | prefetch 끔: **31초**, 김치볶음밥 3개가 worker-1에 몰림. prefetch=1: **19초**, 세 워커에 하나씩 |
| D | 워커를 모두 끄고 주문 5번 | 5건 모두 `queued`, 큐 Ready=5. 워커 1개를 켜자 차례로 처리, 나머지를 켜자 나눠 처리 |
| E | 김치볶음밥 조리 중인 워커를 `kill -9` | 다른 워커가 같은 jobId를 `redelivered: true`로 받아 완료. 이벤트 로그에 `job.started`가 두 번 남음 |
| F | 재료 소진 체크 후 주문 | `failed`(품절), 워커가 시작한 횟수 1번 (재시도 없음) |
| G | 조리 중에 마스터를 끄고 워커가 끝낸 뒤 재시작 | 꺼진 동안 주문은 502. DB는 `started`였다가 재시작 후 `completed`로 갱신 |
| H | D 상태에서 `brew services restart rabbitmq` | 재시작 후에도 Ready=5 유지 |

### 검증하지 못한 것

- 재전달된 `job.started`가 이미 끝난 주문을 되돌리지 못하게 막는 장면 (조건부 UPDATE의 효과). 테스트 E에서는 완료 이벤트가 나오기 전에 워커가 죽어서 재현되지 않았다.
- 발행 실패 시 503 응답. 테스트 G의 502는 마스터가 꺼져서 nginx가 낸 응답이고, 마스터가 낸 503은 시험하지 않았다.
- 마스터와 워커를 `pgrep`으로 확인한 독립 프로세스 4개와 관리 화면의 Connections=4.

### 테스트 C에서 배운 것

처음에는 워커가 메시지를 받는 즉시 동시에 `await sleep`을 걸었다. 그러면 prefetch를 꺼도 한 워커가 김치볶음밥 3개를 동시에 조리해서 오히려 10초로 더 빨리 끝났다(prefetch=1은 20초). 요리사는 한 번에 한 건만 조리해야 하므로 워커가 줄을 세워 하나씩 처리하도록 고쳤고, 그 뒤에 위 표의 31초 대 19초가 나왔다. prefetch의 효과는 **소비자가 한 번에 하나만 처리할 때** 보인다.

## 생각해 볼 점

### 마스터가 2개라면?

1. **왜 고민했나:** 테스트 G에서 마스터가 꺼진 동안 주문을 받지 못했다. 마스터가 단일 장애점이다.
2. **방법 두 가지:** 대기형(active-standby)과 둘 다 일하기(active-active).
3. **둘 다 일할 때 생기는 문제와 지금 설계가 이미 해결한 것:**
   - 상태 공유: 상태를 DB에만 두므로 해결된다.
   - 주문번호 중복: DB가 번호를 매기므로 해결된다.
   - 결과 이벤트가 다른 마스터로 감: 공유 DB와 Polling을 쓰므로 문제없다.
   - 두 마스터가 같은 주문의 이벤트를 동시에 처리: 상태 갱신이 조건부 UPDATE 한 줄이라 서로 덮어쓰지 않는다.
4. **그래도 바꿔야 하는 것:** nginx `upstream` 설정, `PORT`만 다르게 해서 `master.js`를 2번 실행. MySQL은 서버 DB라 두 마스터가 같은 DB를 그대로 공유할 수 있다.
5. **1+3을 고른 이유:** 이 앱의 병목은 조리(워커)라서 늘린다면 워커를 늘리는 게 맞다. 2+2는 주문은 빨리 받지만 요리가 밀린다. 그리고 과제 조건이 1+3이다.
6. **더 생각할 거리:** SSE로 바꾸면 손님과 연결된 마스터와 알림을 받은 마스터가 다를 수 있다. 그러면 모든 마스터가 이벤트를 받는 fanout 구조가 필요하다 (공식 튜토리얼 3번 Pub/Sub).

### 같은 주문이 두 번 처리될 수 있다

테스트 E처럼 워커가 Ack 전에 죽으면 다른 워커가 같은 주문을 다시 조리한다. 완료 이벤트까지 보낸 뒤 죽었다면 완료 이벤트가 두 번 온다. 마스터는 "이미 끝난 주문의 상태는 바꾸지 않는다"는 조건을 UPDATE에 넣어 결과를 망가뜨리지 않는다(멱등성). 다만 조리 자체는 두 번 일어났다. 결제나 발송처럼 두 번 하면 안 되는 작업이라면 워커 쪽에서도 jobId로 중복을 걸러야 한다.

### 실패한 주문은 그냥 버려진다

지금은 실패해도 Ack하고 끝낸다. 실무에서는 Dead Letter Queue로 보내 나중에 원인을 보거나 다시 처리한다.

### 워커가 꺼진 걸 화면이 모른다

테스트 D에서 워커를 모두 꺼도 화면에는 `queued` 주문만 남을 뿐, 요리사가 몇 명 살아 있는지는 알 수 없다. 마스터는 워커가 보낸 이벤트로만 워커를 알기 때문이다. 해결하려면 워커가 주기적으로 "살아 있음" 신호(heartbeat)를 보내야 한다.

### 마스터가 DB 갱신 전에 죽으면?

마스터는 DB 갱신이 끝난 **뒤에** 이벤트를 Ack한다. 갱신 중에 죽으면 이벤트가 큐에 남아 재시작 후 다시 처리된다. `job_events`에는 같은 이벤트가 두 줄 남을 수 있지만, `jobs` 상태는 조건부 UPDATE라 영향이 없다.
