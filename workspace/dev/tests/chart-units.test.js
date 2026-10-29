// Every overview chart has a "View all" page behind it. The chart and that page must count the
// SAME rows, or the same category shows two different numbers - Region-wise read Hyderabad
// 1,164 in the chart and 436 in the table, because the chart used overviewRows() (one row per
// embryo while the unit toggle is on Embryos) and the table used allEmbryos() (one per sample).
//
// These are source-level assertions: the renderers are DOM-bound, so what is pinned here is that
// each pair reads the same function. If you restructure a view, keep the pair matched.
//   node --test tests/*.test.js
const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'..','frontend','app.js'),'utf8');

test('the overview charts all read overviewRows()', () => {
 // renderAnalytics feeds every chart from one row set, so they agree with each other.
 assert.match(src,/const rows=overviewRows\(\),withInternal=overviewRows\(true\);/,
  'renderAnalytics must build both row sets from overviewRows()');
 for(const fn of ['renderVolumeChart','renderOutcomeChart','renderClientChart','renderRegionChart','renderPlatformChart'])
  assert.ok(src.includes(`${fn}(rows)`),`${fn} must be fed the shared overviewRows() set`);
 assert.ok(src.includes('renderTestChart(withInternal)'),
  'the test-wise chart alone also counts internal karyotyping, via overviewRows(true)');
});

test('each drill-down counts the same rows as the chart it opens from', () => {
 const pairs=[
  ['Region','renderRegionMonthTable(\'#allRegionChart\',overviewRows()'],
  ['Client','monthFiltered(overviewRows(),monthSel.value)'],
  ['Test','countBy(overviewRows(true),testNameOf)'],
 ];
 for(const [name,needle] of pairs)
  assert.ok(src.includes(needle),`${name} drill-down must read overviewRows(), not allEmbryos()`);
});

test('no drill-down silently falls back to allEmbryos()', () => {
 // The exact spellings that caused the mismatch. They must not come back.
 for(const bad of [
   "renderRegionMonthTable('#allRegionChart',allEmbryos()",
   'countBy(allEmbryos(),testNameOf)',
   'monthFiltered(allEmbryos(),monthSel.value)',
   '()=>renderClientChart(allEmbryos())',
 ]) assert.ok(!src.includes(bad),`a drill-down is back on allEmbryos(): ${bad}`);
});

test('the embryologist chart and its page agree with each other', () => {
 // This pair counts SAMPLES, not embryos - deliberately, and consistently on both sides. It is
 // the one card whose unit differs from its neighbours; pinned so the two sides stay together.
 const n=src.split('embryologistQcStats(allEmbryos()').length-1;
 assert.strictEqual(n,2,`expected the chart and the all-embryologists page to share one source, found ${n}`);
});

test('a sheet row is a patient, so a row tally is a patient tally', () => {
 // One row in the month sheet is one patient, with that patient's embryo count in the
 // NUMBER OF EMBRYOS column. Deduping on patient name is WRONG here: names like "priyanka",
 // "kavitha" and "saranya" recur across months as different women, and merging them lost 953
 // patients. Patient mode therefore tallies rows directly.
 for(const chart of ['countBy(rows,testNameOf)','countBy(rows,e=>e._case.client)','countBy(rows,e=>e._case.region)'])
  assert.ok(src.includes(chart),`chart must tally rows directly in patient mode: ${chart}`);
 assert.ok(!src.includes('function countUnits('),
  'countUnits() deduped on patient name and merged different patients - it must not come back');
});
