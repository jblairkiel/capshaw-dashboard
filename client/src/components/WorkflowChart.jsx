import { layoutFlow, nodeState } from '../lib/flowLayout';

// Colours per node state. Steps and outcomes read differently on purpose:
// a step is a box, an outcome is a rounded pill you can tell apart at a glance.
const STEP_STYLE = {
  current: { fill: '#fff8e1', stroke: '#c9a227', text: '#1e2a4a', weight: 600 },
  done:    { fill: '#eef2f7', stroke: '#9aa8bd', text: '#4a5568', weight: 500 },
  idle:    { fill: '#ffffff', stroke: '#e2e8f0', text: '#94a3b8', weight: 500 },
};

const OUTCOME_STYLE = {
  good:    { fill: '#ecfdf5', stroke: '#34d399', text: '#065f46' },
  bad:     { fill: '#fef2f2', stroke: '#fca5a5', text: '#991b1b' },
  neutral: { fill: '#f8fafc', stroke: '#cbd5e1', text: '#475569' },
};

function wrap(text, max = 22) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > max && line) { lines.push(line); line = word; }
    else line = (line + ' ' + word).trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 2);
}

export default function WorkflowChart({ chart, currentStepId = '', visited = [], outcome = '', status = 'active' }) {
  if (!chart?.nodes?.length) return null;

  const { width, height, nodes, edges } = layoutFlow(chart);

  return (
    // Wide charts scroll inside their own box rather than widening the page.
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={`Flowchart for ${chart.title || 'workflow'}`}
        className="max-w-full h-auto"
      >
        <defs>
          <marker id="wf-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="#94a3b8" />
          </marker>
        </defs>

        {/* Dashed means the workflow loops back a step; a sideways move is solid. */}
        {edges.map((edge, i) => (
          <g key={`${edge.from}-${edge.to}-${i}`}>
            <path
              d={edge.path}
              fill="none"
              stroke={edge.back ? '#cbd5e1' : '#94a3b8'}
              strokeWidth="1.5"
              strokeDasharray={edge.back ? '4 3' : undefined}
              markerEnd="url(#wf-arrow)"
            />
          </g>
        ))}

        {nodes.map(node => {
          const state = nodeState(node, { currentStepId, visited, outcome, status });
          const isOutcome = node.kind === 'outcome';
          const style = isOutcome
            ? OUTCOME_STYLE[node.tone || 'neutral']
            : STEP_STYLE[state];
          const dim = isOutcome && state !== 'reached' && status === 'completed';
          const lines = wrap(node.label);

          return (
            <g key={node.id} opacity={dim ? 0.45 : 1}>
              <rect
                x={node.x} y={node.y} width={node.w} height={node.h}
                rx={isOutcome ? node.h / 2 : 8}
                fill={style.fill}
                stroke={style.stroke}
                strokeWidth={state === 'current' ? 2 : 1.25}
              />
              {lines.map((line, i) => (
                <text
                  key={i}
                  x={node.x + node.w / 2}
                  y={node.y + node.h / 2 + (i === 0 ? (lines.length > 1 ? -5 : 4) : 11)}
                  textAnchor="middle"
                  fontSize="11.5"
                  fontWeight={style.weight || 500}
                  fill={style.text}
                >
                  {line}
                </text>
              ))}
              {state === 'current' && (
                <circle cx={node.x + node.w - 10} cy={node.y + 10} r="4" fill="#c9a227" />
              )}
            </g>
          );
        })}
      </svg>

      <div className="flex items-center gap-4 mt-2 text-xs text-gray-400 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border-2 border-church-gold bg-amber-50 inline-block" /> Where it is now
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border border-gray-400 bg-gray-100 inline-block" /> Already done
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border border-gray-200 bg-white inline-block" /> Not reached
        </span>
      </div>
    </div>
  );
}
