// Pure scoring + plan logic. No DOM. Loaded by the page and by the tests (node).
(function (root) {
  'use strict';

  // GATE marking: +marks if right, -marks/3 if wrong, 0 if skipped.
  function scoreAttempt(items, answers) {
    let got = 0, total = 0, right = 0, wrong = 0, skipped = 0;
    const perTopic = {};
    items.forEach(function (it, i) {
      const a = answers[i];
      const t = perTopic[it.topic] || (perTopic[it.topic] = { topic: it.topic, right: 0, wrong: 0, skipped: 0, marks: 0, max: 0 });
      total += it.marks; t.max += it.marks;
      if (a == null) { skipped++; t.skipped++; return; }
      if (a === it.answer) { got += it.marks; right++; t.right++; t.marks += it.marks; }
      else { const pen = it.marks / 3; got -= pen; wrong++; t.wrong++; t.marks -= pen; }
    });
    const topics = Object.keys(perTopic).map(function (k) {
      const t = perTopic[k];
      t.pct = t.max ? Math.max(0, t.marks) / t.max : 0;
      t.marks = round2(t.marks);
      return t;
    }).sort(function (a, b) { return a.pct - b.pct; });
    return { marks: round2(got), total: total, right: right, wrong: wrong, skipped: skipped, topics: topics };
  }

  // Rough projection onto the exam's Engineering Maths section (13 marks for EC).
  function estimateSection(result, sectionMarks) {
    const frac = Math.max(0, result.marks) / result.total;
    return Math.round(frac * sectionMarks * 2) / 2;
  }

  // Weak = below 50% of a topic's marks, worst first; always name at least one.
  function weakTopics(result) {
    const weak = result.topics.filter(function (t) { return t.pct < 0.5; });
    return (weak.length ? weak : result.topics.slice(0, 1)).map(function (t) { return t.topic; });
  }

  // 14-day plan: weakest topics get the most days; every topic gets a revisit; day 14 is a timed mixed set.
  function fourteenDayPlan(result) {
    const order = result.topics.map(function (t) { return t.topic; });
    const weak = weakTopics(result);
    const days = [];
    const focus = weak.concat(order.filter(function (t) { return weak.indexOf(t) < 0; }));
    // Days 1-8: two days each on up to 4 weakest/next topics.
    focus.slice(0, 4).forEach(function (topic) {
      days.push({ topic: topic, task: 'Concepts + 10 verified PYQ-style questions. Note every mistake type.' });
      days.push({ topic: topic, task: 'Redo yesterday\'s mistakes without notes, then 10 new questions.' });
    });
    // Remaining topics once each.
    focus.slice(4).forEach(function (topic) {
      days.push({ topic: topic, task: 'Quick revision + 8 verified questions.' });
    });
    while (days.length < 13) {
      const topic = weak[(days.length) % weak.length];
      days.push({ topic: topic, task: 'Mixed set on this topic, 25 minutes, timed.' });
    }
    days.length = 13;
    days.push({ topic: 'All topics', task: 'Timed mixed 20-question set with GATE marking. Compare with today\'s score.' });
    return days.map(function (d, i) { return { day: i + 1, topic: d.topic, task: d.task }; });
  }

  function round2(x) { return Math.round(x * 100) / 100; }

  const api = { scoreAttempt: scoreAttempt, estimateSection: estimateSection, weakTopics: weakTopics, fourteenDayPlan: fourteenDayPlan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VidhyaScore = api;
})(typeof window !== 'undefined' ? window : globalThis);
