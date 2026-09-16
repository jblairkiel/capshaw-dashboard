// Stands in for the Anthropic SDK in the routes that generate class material.
//
// Used as `jest.mock('@anthropic-ai/sdk', () => require('./helpers/anthropicMock').createAnthropicMock())`
// — going through require keeps the factory free of out-of-scope variables,
// which jest.mock does not allow. The resulting constructor carries the
// messages.create spy on `__messagesCreate`, so a test can drive the reply.
function createAnthropicMock() {
  const create    = jest.fn();
  const Anthropic = jest.fn().mockImplementation(() => ({ messages: { create } }));
  Anthropic.__messagesCreate = create;
  return Anthropic;
}

// The routes all read message.content[0].text, so a reply is just that text.
const reply = text => ({ content: [{ text }] });

module.exports = { createAnthropicMock, reply };
