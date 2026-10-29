// The TAT target (team corrected 23-10-2026): 14 days for PGT-A and PGT-SR, 21 for Embryo Sure
// and HLA. It was wrongly 10 days, which flagged the lab's routine ~11-day turnaround as late -
// the TAT performance dialog read 34% met / 66% late; at the correct target it is 93% / 6%.
// This is the one number on the dashboard a lab director will sanity-check by eye against what
// their own team tells them, so it is pinned here rather than left to drift again.
//
// 24-10-2026: the "TAT trends" dialog separately tracks two in-house GOALS (10 days PGT-A/SR,
// 21 Embryo Sure) for Received->Report and WGA->Report, shown as % met - confirmed by the team
// as a deliberately different, stricter number from the 14-day contractual TAT above. tatDate()
// and isOverdue() must stay on 14 days everywhere else; the goal charts must always say "goal"
// so the two numbers are never confused the way they were in the original incident. Sequencing
// ->Report has no agreed goal, so it stays a plain average-days line with no target at all.
//   node --test tests/*.test.js
const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'..','frontend','app.js'),'utf8');
const grabFn=name=>{const i=src.indexOf(`function ${name}(`);if(i<0)return'';const start=src.indexOf('{',i);let depth=0;for(let j=start;j<src.length;j++){if(src[j]==='{')depth++;else if(src[j]==='}'){depth--;if(depth===0)return src.slice(i,j+1)}}return''};

test('PGT-A and PGT-SR get a 14-day TAT, not 10', () => {
 const tatDateSrc=grabFn('tatDate');
 assert.match(tatDateSrc,/\?21:14\)\);return `\$\{String\(d\.getDate/,
  'tatDate() must add 14 days for everything except Embryo Sure/HLA (21 days)');
 assert.ok(!tatDateSrc.includes('?21:10)'),'the old 10-day TAT window must not have crept back into tatDate() itself');
});

test('the Overdue page states the same 14-day window tatDate() measures against', () => {
 assert.ok(src.includes('+ 14 days for all other tests'),
  'the Overdue page description must say 14 days');
});

test('the TAT trends dialog labels its 10-day goals apart from the real 14-day TAT', () => {
 const chartSrc=grabFn('openOverdueTatChart');
 assert.ok(chartSrc,'openOverdueTatChart() should exist');
 assert.ok(chartSrc.includes("daysMetStats('date sample received',10,21)"),
  'Received → Report sent must use the 10/21-day goal, via its own daysMetStats() - never tatDate()');
 assert.ok(chartSrc.includes("daysMetStats('wga done on',10,21)"),
  'WGA done → Report sent must use the same 10/21-day goal');
 assert.ok(chartSrc.includes("avgDaysTrend('seq date')"),
  'Sequencing → Report sent has no agreed goal - it must stay a plain average, not a %');
 assert.ok(chartSrc.includes("tatGoalBlock(recv,'Received → Report sent',10,'received date')"),'the Received chart must pass its real goal day-count and start date through');
 assert.ok(chartSrc.includes("tatGoalBlock(wga,'WGA done → Report sent',10,'WGA date')"),'the WGA chart must pass its real goal day-count and start date through');
 assert.match(grabFn('tatGoalBlock'),/goal: \$\{goalDays\} days \(Embryo Sure 21\)/,'the goal charts must always render the word "goal", never "TAT"');
});
