const makeId = (prefix) => `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;

const uid = (prefix) => makeId(prefix);

module.exports = { makeId, uid };
