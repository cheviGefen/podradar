import { MAX_REPLICAS, type Deployment, type Pod } from "../api";
import { rolloutState } from "../rollout";

interface Props {
  deployments: Deployment[];
  pods: Pod[];
  onScale: (name: string, replicas: number) => void;
  onRestart: (name: string) => void;
}

export function Deployments({ deployments, pods, onScale, onRestart }: Props) {
  return (
    <section className="panel">
      <h2>Deployments</h2>
      <ul className="deployments">
        {deployments.map((deployment) => {
          const { rollingOut, healthy, replaced, progress } = rolloutState(deployment, pods);
          return (
            <li key={deployment.name} className="deployment">
              <div className="deployment-head">
                <span className={`health ${healthy ? "ok" : ""}`} aria-hidden="true" />
                <span className="deployment-name mono">{deployment.name}</span>
                <span className="muted">
                  {deployment.ready_replicas}/{deployment.replicas} ready
                </span>
              </div>

              {rollingOut && (
                <div className="rollout">
                  Rolling out: {replaced}/{deployment.replicas} on the new version
                  <div className="bar">
                    <span style={{ width: `${progress * 100}%` }} />
                  </div>
                </div>
              )}

              <div className="deployment-actions">
                <div className="stepper">
                  <button
                    aria-label={`Scale ${deployment.name} down`}
                    disabled={deployment.replicas === 0}
                    onClick={() => onScale(deployment.name, deployment.replicas - 1)}
                  >
                    −
                  </button>
                  <span aria-label="Desired replicas">{deployment.replicas}</span>
                  <button
                    aria-label={`Scale ${deployment.name} up`}
                    disabled={deployment.replicas === MAX_REPLICAS}
                    onClick={() => onScale(deployment.name, deployment.replicas + 1)}
                  >
                    +
                  </button>
                </div>
                <button className="secondary" onClick={() => onRestart(deployment.name)}>
                  Restart
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
