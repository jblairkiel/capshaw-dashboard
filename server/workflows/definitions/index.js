// The set of workflows this site knows how to run. Adding one is a matter of
// dropping a definition in this folder and listing it here — the engine, the
// inbox and the flowchart all work off the definition alone.

const { isPage } = require('../pages');

const definitions = [
  require('./facilityUse'),
  require('./jobSwap'),
  require('./visitorFollowUp'),
  require('./worshipSchedule'),
];

const byId = new Map(definitions.map(d => [d.id, d]));

function listDefinitions() {
  return definitions;
}

function getDefinition(id) {
  return byId.get(id) || null;
}

// Catches a typo in a `to` target at boot rather than halfway through
// somebody's request. Cheap enough to run on every start-up.
function validateDefinitions() {
  const problems = [];

  for (const def of definitions) {
    // Every workflow is surfaced on a page; a typo here would hide it entirely.
    if (!isPage(def.page)) problems.push(`${def.id}: page "${def.page}" is not a known page`);

    const targets = new Set([...Object.keys(def.steps), ...Object.keys(def.outcomes || {})]);
    if (!def.steps[def.start]) problems.push(`${def.id}: start step "${def.start}" does not exist`);

    for (const [stepId, step] of Object.entries(def.steps)) {
      if (!step.actions?.length) problems.push(`${def.id}.${stepId}: has no actions, so it can never finish`);

      for (const action of step.actions || []) {
        const declared = typeof action.to === 'function' ? (action.possibleTo || []) : [action.to];
        if (!declared.length) {
          problems.push(`${def.id}.${stepId}.${action.id}: conditional target needs possibleTo for the chart`);
        }
        for (const to of declared) {
          if (!targets.has(to)) problems.push(`${def.id}.${stepId}.${action.id}: unknown target "${to}"`);
        }
      }
    }
  }

  return problems;
}

module.exports = { listDefinitions, getDefinition, validateDefinitions };
