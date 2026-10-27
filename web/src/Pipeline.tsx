import type { ReactNode } from 'react'
import { LayoutGroup, motion } from 'motion/react'
import { stageOf } from './flights'
import { WORKERS } from './names'
import type { Job } from './types'

const ROLES = [
  ['React (프론트)', '사용자가 보는 화면. 작업 요청 버튼을 누르고, 1초마다 상태를 물어봄(Polling)'],
  ['nginx', '웹 서버 겸 리버스 프록시. 화면 파일을 주고 /api 요청을 Master로 넘김'],
  ['Master', '작업을 DB에 기록하고 jobs 큐에 발행(Producer). Worker의 결과 이벤트를 받아 DB를 갱신(Consumer)'],
  ['Worker', 'jobs 큐에서 작업을 받아 처리(Consumer). 결과를 job.events 큐에 발행(Producer)'],
  ['RabbitMQ', '메시지 브로커. jobs 큐(처리 대기 작업)와 job.events 큐(결과 알림)를 보관'],
  ['DB (MySQL)', '작업 상태 저장소. Master만 읽고 씀'],
  ['수동 Ack', 'Worker가 결과 이벤트 전달을 확인한 뒤에만 보내는 처리 완료 신호. 그 전에 중단되면 작업이 jobs 큐로 돌아감'],
  ['prefetch=1', 'Worker는 작업을 한 번에 하나씩만 가져감. 일이 끝난 Worker가 다음 작업을 가져감'],
]

function Token({ job, settled }: { job: Job; settled: boolean }) {
  const mark = settled ? (job.status === 'completed' ? '✅' : job.status === 'failed' ? '❌' : '') : ''
  return (
    <motion.div
      layout
      layoutId={`job-${job.id}`}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`token token-${settled ? job.status : 'moving'}`}
    >
      {mark} {job.type}·{job.id}
    </motion.div>
  )
}

type NodeProps = { area: string; icon: string; title: string; sub?: string; children?: ReactNode }

function Node({ area, icon, title, sub, children }: NodeProps) {
  return (
    <div className={`node node-${area}`} style={{ gridArea: area }}>
      <h3>
        <span className="node-icon">{icon}</span> {title} {sub && <small>{sub}</small>}
      </h3>
      {children}
    </div>
  )
}

type Props = {
  jobs: Job[]
  flights: Record<number, string>
  // 장애가 난 워커 (workerId별)
  fallen: Record<string, boolean>
  onCrash: (workerId: string) => void
  orderPanel: ReactNode
}

export default function Pipeline({ jobs, flights, fallen, onCrash, orderPanel }: Props) {
  const byStage: Record<string, Job[]> = {}
  for (const job of jobs) {
    const stage = stageOf(job, flights[job.id], fallen)
    ;(byStage[stage] ??= []).push(job)
  }
  // jobs는 최신순이므로 대기열은 오래된 것부터 보이게 뒤집는다
  const at = (stage: string, settled = false) => (
    <div className="tokens">
      {(stage === 'jobs' ? [...(byStage[stage] ?? [])].reverse() : byStage[stage] ?? []).map((job) => (
        <Token key={job.id} job={job} settled={settled} />
      ))}
    </div>
  )
  const results = (byStage['result'] ?? []).slice(0, 8)

  return (
    <LayoutGroup>
      <section className="pipeline">
        <Node area="front" icon="🖥️" title="프론트" sub="React · 작업 요청">
          {orderPanel}
          {at('front')}
        </Node>

        <Node area="nginx" icon="🔀" title="nginx" sub="프록시">
          {at('nginx')}
        </Node>

        <Node area="master" icon="🧠" title="Master" sub="서버">
          <p className="slot-label">① 작업 접수 → DB 기록 → jobs 큐에 발행</p>
          {at('master-in')}
          <p className="slot-label bottom">② 결과 이벤트 수신 → DB 갱신</p>
          {at('master-out')}
        </Node>

        <Node area="jobs" icon="📬" title="RabbitMQ" sub="jobs 큐">
          {at('jobs')}
        </Node>

        <Node area="events" icon="📬" title="RabbitMQ" sub="job.events 큐">
          {at('events')}
        </Node>

        <Node area="workers" icon="⚙️" title="Worker 3개" sub="prefetch=1">
          {WORKERS.map((worker) => {
            const stage = `worker:${worker.workerId}`
            const working = (byStage[stage] ?? []).length > 0
            return (
              <div key={worker.workerId} className="worker-row">
                <span className={working ? 'worker-icon working' : 'worker-icon'}>
                  {fallen[worker.workerId] ? '⚠️' : '⚙️'}
                </span>
                <span className="worker-name">{worker.name}</span>
                <button
                  className="fall-btn"
                  disabled={fallen[worker.workerId]}
                  onClick={() => onCrash(worker.workerId)}
                >
                  장애 내기
                </button>
                <div className="worker-slot">
                  {fallen[worker.workerId] ? (
                    <span className="idle">중단됨</span>
                  ) : working ? (
                    at(stage)
                  ) : (
                    <span className="idle">대기 중</span>
                  )}
                </div>
              </div>
            )
          })}
        </Node>

        <Node area="db" icon="🗄️" title="DB" sub="MySQL">
          {at('db')}
        </Node>

        <Node area="result" icon="🖥️" title="프론트" sub="1초마다 조회 · 결과">
          <div className="tokens">
            {results.map((job) => (
              <Token key={job.id} job={job} settled />
            ))}
          </div>
        </Node>
      </section>

      <section className="legend">
        <h3>각 요소의 역할</h3>
        <dl>
          {ROLES.map(([name, role]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{role}</dd>
            </div>
          ))}
        </dl>
        <p className="legend-note">
          jobs 큐 대기와 Worker 처리 중은 DB 상태를 그대로 보여 줍니다. 프론트→nginx→Master와
          events 큐→Master→DB→프론트 구간은 순식간이라, 흐름이 보이도록 화면에서 연출한 것입니다.
        </p>
      </section>
    </LayoutGroup>
  )
}
