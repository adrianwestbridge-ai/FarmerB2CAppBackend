const mongoose = require('mongoose');

// Atomic sequence generator for human-readable order / settlement numbers.
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model('Counter', counterSchema);

const nextSequence = async (name) => {
  const doc = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return doc.seq;
};

// e.g. ORD-261017-0042 (IST date + daily sequence).
const nextNumber = async (prefix) => {
  const ist = new Date(Date.now() + 330 * 60000);
  const ymd = ist.toISOString().slice(2, 10).replace(/-/g, '');
  const seq = await nextSequence(`${prefix}-${ymd}`);
  return `${prefix}-${ymd}-${String(seq).padStart(4, '0')}`;
};

module.exports = { Counter, nextSequence, nextNumber };
