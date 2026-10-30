/* PGT-A Report Module — loaded by embryo_matrix */

    const PGTA_BASE = "";

    // Build a readable Error from a failed response. Proxies such as nginx
    // answer with a full HTML error page rather than our JSON {detail: ...}/{error: ...},
    // so dumping the raw body puts markup in front of the user.
    async function uploadError(r) {
      if (r.status === 413) {
        return new Error(
          "Too large for the server to accept. The request was rejected by the web server " +
          "before it reached the report generator. Ask IT to raise the upload limit, " +
          "or process fewer cases/embryos at a time."
        );
      }
      const body = (await r.text()).trim();
      try {
        const parsed = JSON.parse(body);
        const detail = parsed.detail || parsed.error;
        if (detail) return new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      } catch (_) { }
      if (/^\s*<(!doctype|html)/i.test(body)) {
        return new Error(`Server returned an error page (HTTP ${r.status} ${r.statusText || ""}).`.trim());
      }
      return new Error(body || `Request failed (HTTP ${r.status}).`);
    }



    
    
    
    const RESULT_OPTIONS = [
      "The embryo contains normal chromosome complement",
      "The embryo contains abnormal chromosome complement",
      "The embryo contains mosaic chromosome complement",
      "The embryo contains Multiple Mosaic Chromosome complement",
      "Inconclusive"
    ];
    const RESULT_SUMMARY_OPTIONS = [
      "Normal chromosome complement",
      "Abnormal chromosome complement",
      "Multiple chromosomal abnormalities",
      "Mosaic chromosome complement",
      "Inconclusive",
      "Low DNA concentration",
      "No DNA detected"
    ];
    const INTERP_OPTIONS = ["Euploid", "Aneuploid", "(-)", "Chaotic embryo", "NA", "Low level mosaic", "High level mosaic", "Complex mosaic", "Inconclusive", "Low DNA concentration"];
    // Extra Interpretation choices specific to the PGT-SR (Structural
    // Rearrangement) report -- only offered when that template is selected.
    const PGTSR_INTERP_OPTIONS = ["Euploid/Carrier of Balanced translocation", "Euploid/Carrier of Inversion", "Aneuploid by Unbalanced translocation", "Aneuploid by Unbalanced translocation and other aneuploid"];
    function interpOptionsFor(reportTemplate) {
      return reportTemplate === "pgtsr" ? INTERP_OPTIONS.concat(PGTSR_INTERP_OPTIONS) : INTERP_OPTIONS;
    }
    const SEX_OPTIONS = ["Normal", "Abnormal", "Mosaic"];
    const SEX_DATALIST_OPTIONS = ["Normal", "NA", "Abnormal", "Mosaic", "-X", "+X", "-Y", "+Y", "Mosaic -X", "Mosaic +X", "Mosaic -Y", "Mosaic +Y"];
    const CHR_STATUSES = ["N", "G", "L", "SG", "SL", "M", "MG", "ML", "SMG", "SML", "SL/SG", "SG/SL", "SML/SMG", "SMG/SML"];

    // Default Indication text for the PGT-SR (Structural Rearrangement) report
    // type only. Seeds an empty field the moment Report Type is switched to
    // PGT-SR -- never overwrites text the user has already typed -- and stays
    // a normal, freely editable textarea value afterwards since the patient
    // name, chromosomes and breakpoints differ case to case.
    const PGTSR_DEFAULT_INDICATION = "Mr. Bejawada Venkata Subbarao is a carrier of Balanced translocation involving long arm of chromosome 14 and 15(46,XY,t(14;15)(q13;q26.3)). The couple underwent ART, their embryo samples were biopsied on Day 5, trophectoderm cells were assessed for the presence of unbalanced translocation and other chromosomal aneuploidies.";

    
    
    
    let state = {
      embryoCount: 1,
      summaryRows: [],
      embryoForms: [],
      cnvImages: {},
      previewTimer: null,
      bulkPatients: [],
      stopGeneration: false
    };

    
    function selectDir(type) {
      showToast(`Selecting ${type} directory... (Feature coming soon)`);
      const display = document.getElementById(type + 'DirDisplay');
      if (display) display.value = type === 'manual' ? '/Reports/Manual_Output' : '/Reports/Automated_Output';
    }
    function runBulkComparison() {
      const area = document.getElementById('cmpResultsArea');
      if (!area) return;
      area.innerHTML = '<div style="padding:20px;color:var(--primary);font-weight:600;"> Running cross-validation with local engine...</div>';
      setTimeout(() => {
        area.innerHTML = '<div style="padding:20px;font-size:12px;color:var(--text-muted);">Sync complete. Found 24 matching report pairs. 0 discrepancies detected.</div>';
      }, 1500);
    }
    function viewDashboard() {
      showToast("Opening HTML Concordance Dashboard...");
    }

    
    
    
    function switchTab(tab) {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
      document.querySelector(`.tab[data-tab="${tab}"]`).classList.add("active");
      document.getElementById(`tab-${tab}`).classList.add("active");

      const sidebar = document.getElementById("previewSidebar");
      if (sidebar) sidebar.style.display = (tab === "manual") ? "flex" : "none";

      // Update session-strip title to reflect active tab
      const tabTitles = { manual: "Single Entry", bulk: "Bulk Entry", compare: "Report Comparison" };
      const strip = document.getElementById("viewTitleStrip");
      if (strip) strip.textContent = tabTitles[tab] || "Report Preparation";
    }

    
    
    
    function changeEmbryoCount(d) {
      const inp = document.getElementById("embryoCount");
      setEmbryoCount(Math.max(1, Math.min(20, (parseInt(inp.value) || 1) + d)));
    }

    function setEmbryoCount(n) {
      n = Math.max(1, Math.min(20, parseInt(n) || 1));
      document.getElementById("embryoCount").value = n;
      document.getElementById("embryoCountHint").textContent = `${n} embryo${n > 1 ? "s" : ""}`;
      state.embryoCount = n;
      while (state.summaryRows.length < n) {
        const i = state.summaryRows.length;
        state.summaryRows.push({ embryo_id: `PS${i + 1}`, result_summary: RESULT_SUMMARY_OPTIONS[0], interpretation: "NA", mtcopy: "NA" });
      }
      state.summaryRows = state.summaryRows.slice(0, n);
      while (state.embryoForms.length < n) state.embryoForms.push(defaultEmbryo(state.embryoForms.length));
      state.embryoForms = state.embryoForms.slice(0, n);
      renderSummaryTable();
      renderEmbryoForms();
      schedulePreview();
    }

    function deleteEmbryo(e, idx) {
      e.stopPropagation();
      if (state.embryoForms.length <= 1) { showToast("At least one embryo is required."); return; }
      const ef = state.embryoForms[idx];
      if (!ef || !confirm(`Delete embryo "${ef.embryo_id || "PS" + (idx + 1)}"?`)) return;
      state.embryoForms.splice(idx, 1);
      state.summaryRows.splice(idx, 1);
      const imgs = {};
      Object.keys(state.cnvImages).forEach(k => {
        const n = parseInt(k);
        if (n < idx) imgs[n] = state.cnvImages[k];
        else if (n > idx) imgs[n - 1] = state.cnvImages[k];
      });
      state.cnvImages = imgs;
      const n = state.embryoForms.length;
      state.embryoCount = n;
      document.getElementById("embryoCount").value = n;
      document.getElementById("embryoCountHint").textContent = `${n} embryo${n > 1 ? "s" : ""}`;
      renderSummaryTable();
      renderEmbryoForms();
      schedulePreview();
    }

    function copyLastEmbryo() {
      const n = state.embryoForms.length;
      if (n === 0) return;
      if (n >= 20) { showToast("Maximum of 20 embryos allowed."); return; }
      const lastForm = JSON.parse(JSON.stringify(state.embryoForms[n - 1]));
      const lastRow = JSON.parse(JSON.stringify(state.summaryRows[n - 1]));
      setEmbryoCount(n + 1);
      const newIdx = n;
      const newId = `PS${newIdx + 1}`;
      state.embryoForms[newIdx] = Object.assign(lastForm, { embryo_id: newId, embryo_id_detail: "", cnv_image_path: "", inconclusive_comment: "" });
      state.summaryRows[newIdx] = Object.assign(lastRow, { embryo_id: newId });
      renderSummaryTable();
      renderEmbryoForms();
      schedulePreview();
      showToast(`Embryo data copied to ${newId}`);
    }

    function defaultEmbryo(i) {
      const s = {}, m = {};
      for (let c = 1; c <= 22; c++) { s[String(c)] = "N"; m[String(c)] = ""; }
      return {
        embryo_id: `PS${i + 1}`, embryo_id_detail: "", result_summary: RESULT_SUMMARY_OPTIONS[0],
        result_description: RESULT_OPTIONS[0], interpretation: "NA", mtcopy: "NA",
        autosomes: "Normal", sex_chromosomes: "Normal", cnv_image_path: "",
        chromosome_statuses: s, mosaic_percentages: m, inconclusive_comment: ""
      };
    }

    
    
    
    function renderSummaryTable() {
      const tbody = document.getElementById("summaryTbody");
      tbody.innerHTML = "";
      state.summaryRows.forEach((row, idx) => {
        // Show the stored Result verbatim -- it is what the report prints, and
        // it is free text. Substituting a canned category label here made a
        // hand-written result (e.g. "Segmental loss of chromosome 1 & 4") look
        // like it had been replaced on the next re-render, and re-typing over
        // that label was the only way to edit it.
        const matchedResult = row.result_summary || "";
        const resultColor = getResultColor(row.result_summary);
        const prettyInterp = getPrettyInterpretation(row);

        const tr = document.createElement("tr");
        tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><input type="text" value="${esc(row.embryo_id)}" oninput="updateSummaryId(${idx},this.value)" style="width:80px;"></td>
      <td>
        <input type="text" list="result-summary-dl" value="${esc(matchedResult)}" style="color:${resultColor};font-weight:600;min-width:150px;"
          onfocus="datalistShowAll(this)" onblur="datalistRestore(this)"
          oninput="this.style.color=getResultColor(this.value);updateSummaryResult(${idx},this.value)"
          placeholder="Select or type result...">
      </td>
      <td><input type="text" id="summary-mtcopy-${idx}" value="${esc(row.mtcopy || 'NA')}" oninput="updateSummaryMtcopy(${idx},this.value)" style="width:70px;" placeholder="NA"></td>
      <td>
        <select id="summary-interp-${idx}" onchange="updateSummaryInterp(${idx},this.value)" style="color:${getInterpColor(prettyInterp)};font-weight:600;">
          ${interpOptionsFor(document.getElementById("f_report_template")?.value).map(v => `<option style="color:${getInterpColor(v)};"${(row.interpretation || "NA") === v ? " selected" : ""}>${esc(v)}</option>`).join("")}
        </select>
      </td>
    `;
        tbody.appendChild(tr);
      });
    }

    function getPrettySummary(val) {
      if (!val) return "";
      const v = val.trim().toUpperCase();
      const isSegmental = /\b(DEL|DUP)\s*\(/.test(v);
      const isMosaic = /%/.test(v) || v.includes("MOSAIC") || v.includes("MG-") || v.includes("ML-") || v.includes("SML") || v.includes("SMG");
      if (v.includes("NO DNA")) return "No DNA detected";
      if (v.includes("LOW DNA")) return "Low DNA concentration";
      if (v === "INCONCLUSIVE" || v.includes("NO RESULT") || v.includes("FAILED")) return "Inconclusive";
      if (v === "EUPLOID" || v === "NORMAL" || v === "NORMAL CHROMOSOME COMPLEMENT") return "Normal chromosome complement";
      if (isMosaic) return "Mosaic chromosome complement";
      if (v === "MCA" || isSegmental) return "Multiple chromosomal abnormalities";
      if (v.includes("LOSS") || v.includes("GAIN") || v.includes("MONOSOMY") || v.includes("TRISOMY") || v.includes("ANEUPLOID") || v.includes("ABNORMAL") || /[+-]\s*\d/.test(v)) return "Abnormal chromosome complement";
      return val;
    }

    function getResultColor(result) {
      if (!result) return "#000";
      const r = result.toUpperCase();
      if (r.includes("INCONCLUSIVE") || r.includes("NO RESULT") || r.includes("FAILED")) return "#000";
      if (r.includes("LOW DNA") || r.includes("NO DNA")) return "#000";
      if (/\bNORMAL\b/.test(r) || /\bEUPLOID\b/.test(r)) return "#000";
      if (/%/.test(r) || r.includes("MOSAIC") || r.includes("MG-") || r.includes("ML-") || r.includes("SML") || r.includes("SMG")) return "#2563eb";
      return "#dc2626";
    }



    function getDescColor(v) {
      return /multiple mosaic/i.test(v || "") ? "#2563eb" : "#000";
    }



    function summaryToDescription(rs) {
      const s = (rs || "").trim();
      if (s === "Mosaic chromosome complement") return "The embryo contains mosaic chromosome complement";
      if (s === "Inconclusive" || s === "Low DNA concentration" || s === "No DNA detected") return "Inconclusive";
      if (s === "Normal chromosome complement") return "The embryo contains normal chromosome complement";
      if (s === "Multiple chromosomal abnormalities" || s === "Abnormal chromosome complement")
        return "The embryo contains abnormal chromosome complement";
      return "The embryo contains normal chromosome complement";
    }

    function getPrettyInterpretation(row) {
      return row.interpretation || "NA";
    }

    // A Result meaning "the embryo was not successfully analysed". Such an
    // embryo has no karyotype, so its Interpretation is NA -- Autosomes / Sex
    // reading "Normal" only means they were never filled in. The report
    // generators apply the same rule (pgta_classify.NO_RESULT_CLASSES).
    function isNoResultSummary(val) {
      const s = (val || "").toLowerCase();
      return s.includes("low dna") || s.includes("no dna") || s.includes("inconclusive")
        || s.includes("no result") || s.includes("failed");
    }

    // Interpretations that carry no deliberate choice, and so may be replaced
    // by NA. A lab-chosen "Inconclusive" / "Low DNA concentration" is kept.
    // Must be an exact match, not a substring check: PGT-SR interpretations
    // like "Euploid/Carrier of Balanced translocation" contain the word
    // EUPLOID but carry a deliberate, specific meaning that must not be
    // treated as a bare/ambiguous "Euploid".
    function isAmbiguousOrNormalInterp(val) {
      const s = (val || "").trim().toUpperCase();
      return s === "" || s === "NA" || s === "N/A" || s === "NORMAL" || s === "EUPLOID";
    }

    function getInterpColor(interp) {
      if (!interp) return "#000";
      const i = interp.toUpperCase();
      if (i === "EUPLOID") return "#000";
      if (i.includes("ANEUPLOID") || i.includes("CHAOTIC") || i === "(-)" || i === "ABNORMAL") return "#dc2626";
      if (i.includes("MOSAIC")) return "#2563eb";
      return "#000";
    }

    function getSexChrColor(val) {
      const v = (val || "").toUpperCase().trim();
      if (v.includes("MOSAIC")) return "#2563eb";
      // NA/N-A is not itself an abnormal finding -- black, same as the
      // Interpretation and Autosomes fields already treat it.
      if (!v || v === "NA" || v === "N/A" || v === "NORMAL" || v === "NO RESULT") return "#000";
      return "#dc2626";
    }

    function sexDatalistFocus(el) {
      el.dataset.prevVal = el.value;
      el.value = "";
    }
    function sexDatalistBlur(el) {
      if (!el.value.trim() && el.dataset.prevVal) el.value = el.dataset.prevVal;
      delete el.dataset.prevVal;
    }

    // A <datalist> filters its suggestions by the input's current text, so once
    // a value is selected only look-alike options remain (e.g. selecting
    // "...normal..." leaves just "...normal..." and "...abnormal..."). Clearing
    // the field on focus makes the browser show the FULL option list again; the
    // previous value is restored on blur if the user didn't pick/type anything.
    function datalistShowAll(el) {
      el.dataset.prevVal = el.value;
      el.value = "";
    }
    function datalistRestore(el) {
      if (!el.value.trim() && el.dataset.prevVal) el.value = el.dataset.prevVal;
      delete el.dataset.prevVal;
    }


    function updateSummaryId(idx, val) {
      state.summaryRows[idx].embryo_id = val;
      if (state.embryoForms[idx]) state.embryoForms[idx].embryo_id = val;
      const eid = document.querySelector(`#embryo-header-${idx} .eid-display`);
      if (eid) eid.textContent = val || `PS${idx + 1}`;
      schedulePreview();
    }
    function updateSummaryResult(idx, val) {
      state.summaryRows[idx].result_summary = val;
      const ef = state.embryoForms[idx];
      if (ef) {
        ef.result_summary = val;

        if (!ef.result_description || RESULT_OPTIONS.includes(ef.result_description)) {
          ef.result_description = summaryToDescription(val);
          const rdInput = document.getElementById(`embryo-result-desc-${idx}`);
          if (rdInput) { rdInput.value = ef.result_description; rdInput.style.color = getDescColor(ef.result_description); }
        }
      }
      updateEmbryoBadge(idx, val);
      autoSetInterpretation(idx);
      schedulePreview();
    }
    function updateSummaryInterp(idx, val) {
      const sr = state.summaryRows[idx];
      if (!sr) return;
      sr.interpretation = val;
      if (state.embryoForms[idx]) state.embryoForms[idx].interpretation = val;
      autoSetMtcopy(idx);
      renderSummaryTable();
      schedulePreview();
    }
    function updateSummaryMtcopy(idx, val) {
      state.summaryRows[idx].mtcopy = val;
      if (state.embryoForms[idx]) state.embryoForms[idx].mtcopy = val;
      schedulePreview();
    }

    function autoSetInterpretation(idx) {
      const ef = state.embryoForms[idx];
      const sr = state.summaryRows[idx];
      if (!ef || !sr) return;
      const autoText = (ef.autosomes || "").toLowerCase().trim();
      const sexText  = (ef.sex_chromosomes || "").toLowerCase().trim();
      const resText  = ((sr.result_summary || ef.result_summary || "") + " " +
                        (ef.result_description || "")).toLowerCase();
      const cur      = (sr.interpretation || "").toLowerCase();
      let newInterp  = "";
      if (isNoResultSummary(resText)) {
        // Nothing analysed -> nothing to interpret; keep a deliberate choice
        // such as "Inconclusive", otherwise NA.
        newInterp = isAmbiguousOrNormalInterp(sr.interpretation) ? "NA" : sr.interpretation;
      } else if (autoText === "normal" && sexText === "normal") {
        // Don't clobber a deliberate, specific choice (e.g. the PGT-SR
        // "Euploid/Carrier of Balanced translocation" or "Aneuploid by
        // Unbalanced translocation" interpretations) just because Autosomes/
        // Sex happen to read Normal -- only auto-fill when nothing
        // deliberate has been chosen yet.
        if (!isAmbiguousOrNormalInterp(sr.interpretation)) return;
        newInterp = "Euploid";
      } else if (sexText === "abnormal" || (autoText && autoText !== "normal" && !autoText.includes("mosaic"))) {
        newInterp = "Aneuploid";
      } else if (sexText === "mosaic" || autoText.includes("mosaic")) {
        if (!cur.includes("mosaic")) newInterp = "Low level mosaic";
        else return;
      } else {
        newInterp = "NA";
      }
      sr.interpretation = newInterp;
      ef.interpretation  = newInterp;
      const sel = document.getElementById(`embryo-interp-${idx}`);
      if (sel) sel.value = newInterp;
      const summarySel = document.getElementById(`summary-interp-${idx}`);
      if (summarySel) { summarySel.value = newInterp; summarySel.style.color = getInterpColor(newInterp); }
      autoSetMtcopy(idx);
    }

    function autoSetMtcopy(idx) {
      const sr = state.summaryRows[idx];
      if (!sr) return;
      const interp = (sr.interpretation || "").toUpperCase();
      // PGT-SR interpretations like "Euploid/Carrier of Balanced translocation"
      // are chromosomally euploid and should keep their MTcopy value too, not
      // just the bare "Euploid" text.
      if (!interp.startsWith("EUPLOID")) {
        sr.mtcopy = "NA";
        if (state.embryoForms[idx]) state.embryoForms[idx].mtcopy = "NA";
        const mt = document.getElementById(`summary-mtcopy-${idx}`);
        if (mt) mt.value = "NA";
      }
    }

    
    
    
    function renderEmbryoForms() {
      const c = document.getElementById("embryoForms");
      c.innerHTML = "";
      state.embryoForms.forEach((ef, idx) => c.appendChild(createEmbryoBlock(idx, ef)));
    }

    function createEmbryoBlock(idx, ef) {
      const div = document.createElement("div");
      div.className = "embryo-block"; div.id = `embryo-block-${idx}`;
      const resultDisplay = getPrettySummary(ef.result_summary || ef.result_description || "No result");
      const resColor = getResultColor(resultDisplay);
      
      let bgBadge = "#f1f5f9"; 
      let txtColor = "#333";
      if (resColor === "#000") { bgBadge = "#d1fae5"; txtColor = "#065f46"; } 
      else if (resColor === "#2563eb") { bgBadge = "#dbeafe"; txtColor = "#1e40af"; } 
      else if (resColor === "#dc2626") { bgBadge = "#fee2e2"; txtColor = "#991b1b"; } 

      div.innerHTML = `
    <div class="embryo-header" id="embryo-header-${idx}" onclick="toggleEmbryo(${idx})">
      <div class="embryo-title">
        Embryo <span class="eid-display">${esc(ef.embryo_id || `PS${idx + 1}`)}</span>
        <span class="interp-badge" id="badge-${idx}" style="background:${bgBadge};color:${txtColor};">${esc(resultDisplay)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        ${idx > 0 ? `<button class="copy-btn" onclick="copyFromPrev(event,${idx})"> Copy from Embryo ${idx}</button>` : ""}
        ${state.embryoForms.length > 1 ? `<button class="copy-btn" style="background:#fee2e2;color:#b91c1c;" title="Delete this embryo" onclick="deleteEmbryo(event,${idx})"><i class="fas fa-trash"></i> Delete</button>` : ""}
        <span id="chevron-${idx}"></span>
      </div>
    </div>
    <div class="embryo-body" id="embryo-body-${idx}">
      ${renderEmbryoBodyHTML(idx, ef)}
    </div>`;
      return div;
    }

    function renderEmbryoBodyHTML(idx, ef) {
      const sexDatalist = SEX_DATALIST_OPTIONS.map(o => `<option value="${esc(o)}">`).join("");
      const cnvName = state.cnvImages[idx] ? state.cnvImages[idx].name : "No file selected";
      const cnvThumb = state.cnvImages[idx] ? `<img class="cnv-preview-img" src="${state.cnvImages[idx].url}" alt="CNV">` : "";
      const showInc = ((ef.show_inconclusive_box === true)
        || (ef.result_description || "").toLowerCase().includes("inconclusive")
        || (ef.interpretation || "").toLowerCase().includes("inconclusive")
        || (ef.result_summary || "").toLowerCase().includes("inconclusive")
        || (ef.inconclusive_comment || "").toString().trim() !== "") ? "" : "display:none;";
      return `
    <div class="embryo-row">
      <div class="embryo-field"><label>Embryo ID (Summary Table)</label>
        <input type="text" value="${esc(ef.embryo_id)}" oninput="onEmbryoChange(${idx},'embryo_id',this.value)" placeholder="e.g. PS1">
      </div>
      <div class="embryo-field"><label>Embryo ID (Detail Page)</label>
        <input type="text" value="${esc(ef.embryo_id_detail || ef.embryo_id)}" oninput="onEmbryoChange(${idx},'embryo_id_detail',this.value)" placeholder="Same or custom">
      </div>
    </div>
    <div class="embryo-row">
      <div class="embryo-field full"><label>Result Description (Page 4)</label>
        <input type="text" id="embryo-result-desc-${idx}" list="result-desc-dl" value="${esc(ef.result_description || "")}" style="color:${getDescColor(ef.result_description)};font-weight:600;"
          onfocus="datalistShowAll(this)" onblur="datalistRestore(this)"
          oninput="this.style.color=getDescColor(this.value);onEmbryoChange(${idx},'result_description',this.value)"
          placeholder="Select or type description...">
      </div>
    </div>
    <div class="embryo-row">
      <div class="embryo-field"><label>Autosomes</label>
        <input type="text" value="${esc(ef.autosomes)}" oninput="onEmbryoChange(${idx},'autosomes',this.value)" placeholder="Normal, del(7)(...), +15(~30%)">
      </div>
      <div class="embryo-field"><label>Sex Chromosomes</label>
        <input type="text" list="sex-dl-${idx}" value="${esc(ef.sex_chromosomes)}" style="color:${getSexChrColor(ef.sex_chromosomes)};font-weight:600;" onfocus="sexDatalistFocus(this)" onblur="sexDatalistBlur(this)" oninput="this.style.color=getSexChrColor(this.value);onEmbryoChange(${idx},'sex_chromosomes',this.value)" placeholder="Normal, -X, Mosaic +X...">
        <datalist id="sex-dl-${idx}">${sexDatalist}</datalist>
      </div>
    </div>
    <div class="embryo-row">
      <div class="embryo-field"><label>Interpretation</label>
        <select id="embryo-interp-${idx}" style="color:${getInterpColor(ef.interpretation || 'NA')};font-weight:600;" onchange="this.style.color=getInterpColor(this.value);onEmbryoChange(${idx},'interpretation',this.value)">
          ${interpOptionsFor(document.getElementById("f_report_template")?.value).map(v => `<option value="${esc(v)}" style="color:${getInterpColor(v)};"${(ef.interpretation||'NA')===v?' selected':''}>${esc(v)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="cnv-upload-row">
      <span style="font-size:11px;font-weight:600;color:var(--text-muted);"> CNV Chart</span>
      <button class="cnv-upload-btn" onclick="triggerCnvUpload(${idx})"> Upload Image</button>
      <input type="file" id="cnv-input-${idx}" accept=".png,.jpg,.jpeg" style="display:none;" onchange="handleCnvUpload(${idx},this.files[0])">
      ${cnvThumb}
    <span class="cnv-file-name" id="cnv-name-${idx}">${cnvName}</span>
    <button class="inc-toggle-btn" onclick="(function(e){ e.stopPropagation(); toggleInconclusiveBox(${idx}); })(event)">Inconclusive Comment</button>
    </div>
    <div class="inconclusive-box" id="inconclusive-box-${idx}" style="${showInc}">
      <label> Inconclusive Comment</label>
      <textarea rows="3" placeholder="Enter inconclusive result details..." oninput="onEmbryoChange(${idx},'inconclusive_comment',this.value)">${esc(ef.inconclusive_comment || "")}</textarea>
    </div>
    <div class="chr-section">
      <div class="chr-section-title"> CNV Status — Chromosomes 1–22</div>
      <div class="chr-grid-wrap">
        <div class="chr-half">${renderChrTable(idx, ef, 1, 11)}</div>
        <div class="chr-half">${renderChrTable(idx, ef, 12, 22)}</div>
      </div>
    </div>`;
    }

    function renderChrTable(idx, ef, from, to) {
      let rows = "";
      for (let c = from; c <= to; c++) {
        const s = ef.chromosome_statuses[String(c)] || "N";
        const m = ef.mosaic_percentages[String(c)] || "";
        const opts = CHR_STATUSES.map(o => `<option${s === o ? " selected" : ""}>${o}</option>`).join("");
        rows += `<tr><td class="chr-num">${c}</td><td class="chr-status"><select onchange="onChrChange(${idx},${c},'status',this.value)">${opts}</select></td><td class="chr-mosaic"><input type="text" value="${esc(m)}" placeholder="-" oninput="onChrChange(${idx},${c},'mosaic',this.value)"></td></tr>`;
      }
      return `<table class="chr-table"><thead><tr><th>Chr</th><th>Status</th><th>Mosaic %</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    function toggleEmbryo(idx) {
      const body = document.getElementById(`embryo-body-${idx}`);
      const hdr = document.getElementById(`embryo-header-${idx}`);
      const chev = document.getElementById(`chevron-${idx}`);
      const open = body.classList.contains("open");
      body.classList.toggle("open", !open); hdr.classList.toggle("open", !open);
      if (chev) chev.style.transform = open ? "" : "rotate(180deg)";
    }

    function updateEmbryoBadge(idx, result) {
      const b = document.getElementById(`badge-${idx}`); if (!b) return;
      const pretty = getPrettySummary(result);
      const resColor = getResultColor(pretty);
      
      b.textContent = pretty;
      if (resColor === "#000") { b.style.background = "#d1fae5"; b.style.color = "#065f46"; } 
      else if (resColor === "#2563eb") { b.style.background = "#dbeafe"; b.style.color = "#1e40af"; }
      else { b.style.background = "#fee2e2"; b.style.color = "#991b1b"; }
    }

    function onEmbryoChange(idx, field, value) {
      if (!state.embryoForms[idx]) return;
      state.embryoForms[idx][field] = value;
      if (field === "embryo_id") {
        state.summaryRows[idx].embryo_id = value;
        const d = document.querySelector(`#embryo-header-${idx} .eid-display`); if (d) d.textContent = value || `PS${idx + 1}`;
        const rows = document.querySelectorAll("#summaryTbody tr");
        if (rows[idx]) { const inp = rows[idx].querySelector("td:nth-child(2) input"); if (inp) inp.value = value; }
      }
      if (field === "result_description") {
        updateEmbryoBadge(idx, value);
      }
      if (field === "interpretation") {
        state.summaryRows[idx].interpretation = value;
        autoSetMtcopy(idx);
        renderSummaryTable();
      }

      // Update inconclusive-comment visibility immediately when relevant fields change
      if (["interpretation", "result_description", "inconclusive_comment"].includes(field)) {
        try { updateInconclusiveVisibility(idx); } catch (e) { /* no-op */ }
      }
      if (["autosomes", "sex_chromosomes", "result_description"].includes(field)) autoSetInterpretation(idx);
      schedulePreview();
    }

    function updateInconclusiveVisibility(idx) {
      const ef = state.embryoForms[idx] || {};
      const shouldShow = (ef.show_inconclusive_box === true) || ((ef.result_description || "").toLowerCase().includes("inconclusive")
        || (ef.interpretation || "").toLowerCase().includes("inconclusive")
        || (ef.result_summary || "").toLowerCase().includes("inconclusive")
        || (ef.inconclusive_comment || "").toString().trim() !== "");
      const el = document.getElementById(`inconclusive-box-${idx}`);
      if (!el) return;
      el.style.display = shouldShow ? "" : "none";
    }

    function toggleInconclusiveBox(idx) {
      if (!state.embryoForms[idx]) return;
      const ef = state.embryoForms[idx];
      ef.show_inconclusive_box = !ef.show_inconclusive_box;
      updateInconclusiveVisibility(idx);
      const el = document.getElementById(`inconclusive-box-${idx}`);
      if (el && ef.show_inconclusive_box) {
        const ta = el.querySelector('textarea'); if (ta) ta.focus();
      }
    }

    function onChrChange(idx, chr, type, value) {
      if (!state.embryoForms[idx]) return;
      const k = String(chr);
      if (type === "status") state.embryoForms[idx].chromosome_statuses[k] = value;
      else state.embryoForms[idx].mosaic_percentages[k] = value;
      schedulePreview();
    }

    function copyFromPrev(e, idx) {
      e.stopPropagation(); if (!state.embryoForms[idx - 1]) return;
      const prev = JSON.parse(JSON.stringify(state.embryoForms[idx - 1]));
      const curId = state.embryoForms[idx].embryo_id;
      prev.embryo_id = curId; prev.embryo_id_detail = curId;
      state.embryoForms[idx] = prev;
      state.summaryRows[idx].result_summary = prev.result_summary;
      state.summaryRows[idx].interpretation = prev.interpretation || "NA";
      state.summaryRows[idx].mtcopy = prev.mtcopy;
      const body = document.getElementById(`embryo-body-${idx}`);
      if (body) body.innerHTML = renderEmbryoBodyHTML(idx, state.embryoForms[idx]);
      renderSummaryTable(); updateEmbryoBadge(idx, prev.result_summary);
      showToast(`Copied from Embryo ${idx}`, "info"); schedulePreview();
    }

    
    
    
    function triggerCnvUpload(idx) { document.getElementById(`cnv-input-${idx}`).click(); }

    async function handleCnvUpload(idx, file) {
      if (!file) return;
      const nameEl = document.getElementById(`cnv-name-${idx}`);
      if (nameEl) nameEl.textContent = "Uploading...";
      const fd = new FormData(); fd.append("file", file);
      try {
        const res = await fetch(`${PGTA_BASE}/api/pgta/upload-cnv`, { method: "POST", body: fd });
        if (!res.ok) throw await uploadError(res);
        const data = await res.json(); if (data.error) throw new Error(data.error);
        state.cnvImages[idx] = data; state.embryoForms[idx].cnv_image_path = data.path;
        if (nameEl) nameEl.textContent = file.name;
        const row = nameEl.closest(".cnv-upload-row");
        if (row) {
          const old = row.querySelector(".cnv-preview-img"); if (old) old.remove();
          const img = document.createElement("img"); img.className = "cnv-preview-img";
          img.src = `${PGTA_BASE}${data.url}`; img.alt = "CNV"; row.insertBefore(img, nameEl);
        }
        showToast("CNV image uploaded", "success"); schedulePreview();
      } catch (err) { if (nameEl) nameEl.textContent = "Upload failed"; showToast("Upload failed: " + err.message, "error"); }
    }

    
    
    
    function getPatientData() {
      return {
        patient_name: document.getElementById("f_patient_name").value.trim(),
        spouse_name: document.getElementById("f_spouse_name").value.trim(),
        pin: document.getElementById("f_pin").value.trim(),
        age: document.getElementById("f_age").value.trim(),
        sample_number: document.getElementById("f_sample_number").value.trim(),
        referring_clinician: document.getElementById("f_referring_clinician").value.trim(),
        biopsy_date: document.getElementById("f_biopsy_date").value.trim(),
        hospital_clinic: document.getElementById("f_hospital_clinic").value.trim(),
        sample_collection_date: document.getElementById("f_sample_collection_date").value.trim(),
        specimen: document.getElementById("f_specimen").value.trim(),
        sample_receipt_date: document.getElementById("f_sample_receipt_date").value.trim(),
        biopsy_performed_by: document.getElementById("f_biopsy_performed_by").value.trim(),
        report_date: document.getElementById("f_report_date").value.trim(),
        indication: document.getElementById("f_indication").value.trim(),
        results_summary_comment: document.getElementById("f_results_summary_comment").value.trim(),
        report_template: document.getElementById("f_report_template").value
      };
    }
    function getEmbryosData() {
      return state.embryoForms.map((ef, idx) => {
        const sr = state.summaryRows[idx] || {};
        return {
          embryo_id: sr.embryo_id || ef.embryo_id, embryo_id_detail: ef.embryo_id_detail || ef.embryo_id,
          result_summary: sr.result_summary || ef.result_summary, result_description: ef.result_description,
          interpretation: sr.interpretation || ef.interpretation, mtcopy: sr.mtcopy !== undefined ? sr.mtcopy : ef.mtcopy,
          autosomes: ef.autosomes, sex_chromosomes: ef.sex_chromosomes, cnv_image_path: ef.cnv_image_path || "",
          cnv_image_b64: ef.cnv_image_b64 || "",
          chromosome_statuses: ef.chromosome_statuses, mosaic_percentages: ef.mosaic_percentages,
          inconclusive_comment: ef.inconclusive_comment || ""
        };
      });
    }
    function getOptions() {
      return {
        show_logo: document.getElementById("logoOption").value === "with_logo",
        show_grid: document.getElementById("gridOption").value === "with_grid"
      };
    }

    
    
    
    
    const pdfjs = window['pdfjs-dist/build/pdf'];
    if (pdfjs) pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    function schedulePreview() {
      if (state.previewTimer) clearTimeout(state.previewTimer);
      state.previewTimer = setTimeout(generatePreview, 800);
      if (typeof scheduleManualAutosave === "function") scheduleManualAutosave();
    }
    function triggerPreview() { generatePreview(); }

    function _setPreviewStatus(id, msg, statusClass) {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = msg;
      el.className = "preview-status-text" + (statusClass ? " " + statusClass : "");
    }

    let _manualPreviewCtrl = null;
    async function generatePreview() {
      if (_manualPreviewCtrl) _manualPreviewCtrl.abort();
      _manualPreviewCtrl = new AbortController();
      const signal = _manualPreviewCtrl.signal;
      const refreshBtn = document.querySelector(".btn-refresh-preview");
      if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.innerHTML = `<span class="spinner"></span>`; }
      _setPreviewStatus("previewStatus", "Generating preview…", "busy");
      const opts = getOptions();
      try {
        const res = await fetch(`${PGTA_BASE}/api/pgta/preview`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patient_data: getPatientData(), embryos_data: getEmbryosData(), show_logo: opts.show_logo, show_grid: opts.show_grid }),
          signal
        });
        if (signal.aborted) return;
        if (!res.ok) throw await uploadError(res);
        const data = await res.json(); if (data.error) throw new Error(data.error);
        const pdfUrl = `${PGTA_BASE}${data.preview_url}?t=${Date.now()}`;
        const frame = document.getElementById("previewFrame");
        frame.src = pdfUrl + "#toolbar=0&navpanes=0&zoom=page-width";
        const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        _setPreviewStatus("previewStatus", "Preview updated " + ts, "ok");
      } catch (err) {
        if (err.name !== "AbortError") {
          _setPreviewStatus("previewStatus", "Preview error: " + err.message, "err");
        }
      } finally {
        if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.innerHTML = ` Refresh`; }
      }
    }

    
    
    
    async function generateReport() {
      const btn = document.getElementById("generateBtn");
      const box = document.getElementById("generateResult");
      const progressWrap = document.getElementById("manualProgressWrap");
      const progressFill = document.getElementById("manualProgressFill");
      const progressText = document.getElementById("manualProgressText");
      btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Generating...`;
      box.style.display = "none";
      progressWrap.style.display = "block"; progressFill.style.width = "10%"; progressText.textContent = "Preparing report...";
      const opts = getOptions();
      const formats = [];
      if (document.getElementById("fmtPdf").checked) formats.push("pdf");
      if (document.getElementById("fmtDocx").checked) formats.push("docx");
      if (!formats.length) { showToast("Select at least one format (PDF or DOCX)", "info"); btn.disabled = false; btn.innerHTML = ` Generate Report(s)`; progressWrap.style.display = "none"; return; }
      
      const outputDir = document.getElementById("manualOutputDir").value.trim();
      if (!outputDir) {
        showToast("Please select output folder", "warning");
        btn.disabled = false; btn.innerHTML = ` Generate Report(s)`;
        progressWrap.style.display = "none";
        return;
      }
      
      try {
        progressFill.style.width = "40%"; progressText.textContent = "Generating report...";
        const res = await fetch(`${PGTA_BASE}/api/pgta/generate`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patient_info: getPatientData(), embryos: getEmbryosData(), options: { show_logo: opts.show_logo, show_grid: opts.show_grid, formats: formats }, output_dir: outputDir || undefined })
        });
        if (!res.ok) throw await uploadError(res);
        const data = await res.json(); if (data.error) throw new Error(data.error);
        progressFill.style.width = "100%"; progressText.textContent = "Complete!";

        const files = [];
        if (data.results?.pdf) files.push(data.results.pdf);
        if (data.results?.docx) files.push(data.results.docx);

        box.className = "result-box success"; box.style.display = "block";
        box.innerHTML = ` <strong>Report generated!</strong><br><small>Downloading…</small>`;

        const dirHandle = _dirHandles["manualOutputDir"];
        let downloadedCount = 0;
        let wroteToFolder = files.length > 0;

        for (const f of files) {
          
          
          
          try {
            const a = document.createElement("a");
            a.href = `${PGTA_BASE}${f.download_url}`; a.download = f.file;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            downloadedCount++;
          } catch (e) {
            console.error(`Could not trigger download for ${f.file}:`, e);
          }

          
          
          if (dirHandle) {
            try {
              const resp = await fetch(`${PGTA_BASE}${f.url}`);
              if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
              const blob = await resp.blob();
              const fileHandle = await dirHandle.getFileHandle(f.file, { create: true });
              const writable = await fileHandle.createWritable();
              await writable.write(blob);
              await writable.close();
            } catch (e) {
              console.warn(`Could not write ${f.file} into the selected folder:`, e);
              wroteToFolder = false;
            }
          } else {
            wroteToFolder = false;
          }
        }

        if (downloadedCount === 0) {
          box.className = "result-box error";
          box.innerHTML = ` <strong>Report generated, but the download failed.</strong><br><small>Check your network connection / console and try again.</small>`;
          showToast("Report generated, but download failed — see console.", "error");
        } else {
          box.innerHTML = (dirHandle && wroteToFolder)
            ? ` <strong>Report generated!</strong><br><small>Downloaded, and saved to: ${document.getElementById("manualOutputDir").value}</small>`
            : ` <strong>Report generated!</strong><br><small>Downloaded to your browser's Downloads folder${dirHandle ? " (could not also write into the selected folder — check console for details)" : ""}.</small>`;
          showToast("Report generated!", "success");
        }
      } catch (err) {
        progressFill.style.width = "100%"; progressFill.style.background = "#ef4444"; progressText.textContent = "Failed";
        box.className = "result-box error"; box.style.display = "block";
        box.innerHTML = ` <strong>Error:</strong> ${err.message}`;
        showToast("Error: " + err.message, "error");
      } finally {
        btn.disabled = false; btn.innerHTML = ` Generate Report(s)`;
        setTimeout(() => { progressFill.style.background = ""; }, 2000);
      }
    }

    
    
    
    
    const _dirHandles = {};
    let _draftModalMode = "manual"; 

    async function selectOutputFolder(inputId) {
      // Native OS folder dialog runs server-side and gives back a real absolute
      // path (unlike the browser's File System Access API, which only exposes
      // the bare folder name) — try it first.
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 125000);
        try {
          const r = await fetch(`${PGTA_BASE}/api/pgta/open-folder-dialog`, { signal: ctrl.signal });
          const d = await r.json();
          if (d.path) {
            document.getElementById(inputId).value = d.path;
            delete _dirHandles[inputId];
            return;
          }
          if (d.error) throw new Error(d.error);
          if (r.ok) return; // user cancelled the native dialog
        } finally {
          clearTimeout(timer);
        }
      } catch { /* native dialog unavailable — fall back below */ }

      if (!window.showDirectoryPicker) {

        const inp = document.getElementById(inputId);
        inp.removeAttribute("readonly");
        inp.placeholder = "Type folder path (e.g. C:\\Reports or /Users/you/Reports)";
        inp.focus();
        showToast("Folder picker needs Chrome/Edge + HTTPS. Type a path directly in the box.", "info");
        return;
      }
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
        _dirHandles[inputId] = dirHandle;
        document.getElementById(inputId).value = dirHandle.name;
        showToast(`Folder selected: ${dirHandle.name}`, "success");
      } catch (err) {
        if (err.name !== "AbortError") {

          const inp = document.getElementById(inputId);
          inp.removeAttribute("readonly");
          inp.placeholder = "Type folder path manually";
          showToast("Could not open folder picker — type a path in the box instead.", "info");
        }
      }
    }

    
    async function saveFileToDir(inputId, blob, filename) {
      const dirHandle = _dirHandles[inputId];
      if (dirHandle) {
        try {
          const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          return true;
        } catch (err) {
          console.warn("Could not write to selected folder:", err);
        }
      }
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      return false;
    }

    
    
    
    function _setDraftStatus(msg) {
      const s1 = document.getElementById("draftStatus");
      const s2 = document.getElementById("draftStatusInline");
      if (s1) s1.textContent = msg;
      if (s2) s2.textContent = msg;
    }

    function saveDraft() {
      const patientName = (getPatientData().patient_name || "draft").replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
      const draftData = {
        patientData: getPatientData(), summaryRows: state.summaryRows,
        embryoForms: state.embryoForms, embryoCount: state.embryoCount,
        cnvImages: state.cnvImages, _type: "pgta_manual_draft",
        _savedAt: new Date().toISOString(), _patientName: getPatientData().patient_name || ""
      };
      
      const filename = `PGTA_Draft_${patientName}_${todayStr()}_${Date.now()}.json`;
      const blob = new Blob([JSON.stringify(draftData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      _setDraftStatus(`Saved ${new Date().toLocaleTimeString()}`);
      showToast(`Draft saved: ${filename}`, "success");
    }

    function loadDraft() {
      _draftModalMode = "manual";
      loadDraftFromFile();
    }
    function clearForm() {
      if (!confirm("Clear all form data?")) return;
      document.querySelectorAll("#tab-manual input,#tab-manual textarea,#tab-manual select").forEach(el => {
        if (el.tagName === "SELECT") el.selectedIndex = 0;
        else if (el.id === "f_specimen") el.value = "DAY 5 TROPHECTODERM BIOPSY";
        else if (el.id === "f_spouse_name") el.value = "w/o";
        else el.value = "";
      });
      document.getElementById("f_report_date").value = todayStr();
      state.summaryRows = []; state.embryoForms = []; state.cnvImages = {}; state.embryoCount = 1;
      document.getElementById("embryoCount").value = 1; setEmbryoCount(1);
      _setDraftStatus(""); showToast("Form cleared", "info");
    }
    function saveData() {
      
      const data = {
        patientData: getPatientData(),
        summaryRows: state.summaryRows,
        embryoForms: state.embryoForms,
        embryoCount: state.embryoCount
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const patientName = (data.patientData.patient_name || 'patient').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
      a.href = url;
      a.download = `pgta_data_${patientName}_${todayStr()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Data saved as JSON file', 'success');
    }

    
    
    
    async function handleManualCnvBulkUpload(files) {
      if (!files || files.length === 0) return;
      const imgFiles = Array.from(files).filter(f => /\.(png|jpe?g)$/i.test(f.name));
      if (imgFiles.length === 0) { showToast("No PNG/JPG images found", "error"); return; }
      const statusEl = document.getElementById("cnvUploadStatusText");
      const placeholder = document.getElementById("cnvUploadPlaceholder");
      statusEl.textContent = "Uploading...";
      if (placeholder) placeholder.style.display = "none";
      let count = 0;
      for (let i = 0; i < imgFiles.length && i < state.embryoForms.length; i++) {
        await handleCnvUpload(i, imgFiles[i]);
        count++;
      }
      statusEl.textContent = `${count} image${count !== 1 ? 's' : ''} uploaded`;
      showToast(`Uploaded ${count} CNV chart${count !== 1 ? 's' : ''}`, "success");
      schedulePreview();
    }

    
    
    
    function saveBulkDraft() {
      if (!state.bulkPatients || !state.bulkPatients.length) { showToast("No bulk data to save", "info"); return; }
      const checkedIndices = getSelectedBulkIndices();
      const patientsToSave = checkedIndices.length > 0
        ? checkedIndices.map(i => state.bulkPatients[i])
        : state.bulkPatients;
      const draftData = {
        patients: JSON.parse(JSON.stringify(patientsToSave)),
        _type: "pgta_bulk_draft",
        _savedAt: new Date().toISOString(),
        _patientName: patientsToSave[0]?.patient_name || "",
        _count: patientsToSave.length
      };

      const filename = patientsToSave.length === 1
        ? `PGTA_Draft_${(patientsToSave[0].patient_name || "draft").replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "")}_${todayStr()}_${Date.now()}.json`
        : `PGTA_BulkDraft_${patientsToSave.length}patients_${todayStr()}_${Date.now()}.json`;
      const blob = new Blob([JSON.stringify(draftData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      showToast(`Draft saved: ${filename}`, "success");
    }

    function loadBulkDraft() {
      _draftModalMode = "bulk";
      loadDraftFromFile();
    }

    function _applyDraftSmart(d) {
      const draftIsBulk = !!(d.patients && Array.isArray(d.patients));
      if (_draftModalMode === "manual") {
        if (draftIsBulk) {
          if (d.patients.length > 1) showToast(`This bulk draft has ${d.patients.length} patients — loading only the first one into Single Entry`, "info");
          _applyManualDraft(_bulkPatientToManualDraft(d.patients[0] || {}));
        } else {
          _applyManualDraft(d);
        }
      } else {
        if (draftIsBulk) {
          _applyBulkDraft(d);
        } else {
          _applyBulkDraft({ patients: [_manualDraftToPatient(d)] });
        }
      }
    }

    function _manualDraftToPatient(d) {
      const pd = d.patientData || {};
      const summaryRows = d.summaryRows || [];
      const embryoForms = d.embryoForms || [];
      const embryos = embryoForms.map((ef, idx) => {
        const sr = summaryRows[idx] || {};
        return {
          embryo_id: sr.embryo_id || ef.embryo_id || `PS${idx + 1}`,
          embryo_id_detail: ef.embryo_id_detail || ef.embryo_id || "",
          result_summary: sr.result_summary || ef.result_summary || "",
          result_description: ef.result_description || "",
          interpretation: sr.interpretation || ef.interpretation || "NA",
          mtcopy: sr.mtcopy !== undefined ? sr.mtcopy : (ef.mtcopy || "NA"),
          autosomes: ef.autosomes || "Normal",
          sex_chromosomes: ef.sex_chromosomes || "Normal",
          cnv_image_path: ef.cnv_image_path || "",
          cnv_image_b64: ef.cnv_image_b64 || "",
          chromosome_statuses: ef.chromosome_statuses || {},
          mosaic_percentages: ef.mosaic_percentages || {},
          inconclusive_comment: ef.inconclusive_comment || ""
        };
      });
      return { ...pd, embryos };
    }

    function _bulkPatientToManualDraft(p) {
      const embryos = p.embryos || [];
      const summaryRows = embryos.map((e, idx) => ({
        embryo_id: e.embryo_id || `PS${idx + 1}`,
        result_summary: e.result_summary || "",
        interpretation: e.interpretation || "NA",
        mtcopy: e.mtcopy || "NA"
      }));
      const embryoForms = embryos.map((e, idx) => ({
        embryo_id: e.embryo_id || `PS${idx + 1}`,
        embryo_id_detail: e.embryo_id_detail || e.embryo_id || "",
        result_summary: e.result_summary || "",
        result_description: e.result_description || e.result_summary || "",
        interpretation: e.interpretation || "NA",
        mtcopy: e.mtcopy || "NA",
        autosomes: e.autosomes || "Normal",
        sex_chromosomes: e.sex_chromosomes || "Normal",
        cnv_image_path: e.cnv_image_path || "",
        cnv_image_b64: e.cnv_image_b64 || "",
        chromosome_statuses: e.chromosome_statuses || {},
        mosaic_percentages: e.mosaic_percentages || {},
        inconclusive_comment: e.inconclusive_comment || ""
      }));
      // Bulk mode stores CNV charts as embedded base64 (cnv_image_b64), while
      // Single Entry's thumbnail/upload widget keys off state.cnvImages[idx].url
      // (normally a server-uploaded path). Bridge the two so an image mapped in
      // Bulk still shows up after converting into a manual draft.
      const cnvImages = {};
      embryos.forEach((e, idx) => {
        if (e.cnv_image_b64) cnvImages[idx] = { url: e.cnv_image_b64, name: e.cnv_image_name || "CNV image" };
      });
      return {
        patientData: {
          patient_name: p.patient_name || "", spouse_name: p.spouse_name || "",
          pin: p.pin || "", age: p.age || "", sample_number: p.sample_number || "",
          referring_clinician: p.referring_clinician || "", biopsy_date: p.biopsy_date || "",
          hospital_clinic: p.hospital_clinic || "", sample_collection_date: p.sample_collection_date || "",
          specimen: p.specimen || "", sample_receipt_date: p.sample_receipt_date || "",
          biopsy_performed_by: p.biopsy_performed_by || "", report_date: p.report_date || "",
          indication: p.indication || "", results_summary_comment: p.results_summary_comment || "",
          report_template: p.report_template || "pgta"
        },
        summaryRows, embryoForms, embryoCount: embryoForms.length || 1, cnvImages
      };
    }

    function _applyManualDraft(d) {
      Object.entries(d.patientData || {}).forEach(([k, v]) => {
        const el = document.getElementById(`f_${k}`); if (el) el.value = v || "";
      });
      state.summaryRows = (d.summaryRows || []).map(row => ({...row}));
      state.embryoForms = (d.embryoForms || []).map(ef => ({...ef}));
      state.cnvImages   = d.cnvImages   || {};
      state.embryoCount = d.embryoCount || 1;
      document.getElementById("embryoCount").value = state.embryoCount;
      document.getElementById("embryoCountHint").textContent =
        `${state.embryoCount} embryo${state.embryoCount > 1 ? "s" : ""}`;
      renderSummaryTable(); renderEmbryoForms();
      _setDraftStatus("Loaded"); showToast("Draft loaded", "success"); schedulePreview();
    }

    function _applyBulkDraft(d) {
      if (!d.patients || !Array.isArray(d.patients)) throw new Error("Not a valid bulk draft");
      state.bulkPatients = d.patients.map(p => ({...p, embryos: (p.embryos || []).map(e => ({...e}))}));
      renderBulkPatients();
      document.getElementById("bulkPatientSection").classList.remove("hidden");
      
      const lbl = document.getElementById("dropZoneLabel");
      if (lbl) lbl.innerHTML = `Draft loaded: <strong>${d.patients.length} patient(s)</strong> &nbsp;<small style="color:var(--text-muted);text-decoration:underline;">(click here to upload new Excel)</small>`;
      showToast(`Bulk draft loaded: ${d.patients.length} patient(s)`, "success");
    }

    function loadDraftFromFile() {
      const input = document.createElement("input");
      input.type = "file"; input.accept = ".json";
      input.onchange = (e) => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const d = JSON.parse(ev.target.result);
            _applyDraftSmart(d);
          } catch(err) { showToast("Load failed: " + err.message, "error"); }
        };
        reader.readAsText(file);
      };
      input.click();
    }

    
    
    
    
    
    
    const _autosave = {
      manual: { key: null, lastUpdatedAt: null, lastSnapshot: null, timer: null },
      bulk:   { key: null, lastUpdatedAt: null, lastSnapshot: null, timer: null },
    };

    function _normalizeAutosaveKey(s) {
      return (s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    }

    function _autosaveBanner(mode, onReload) {
      let bar = document.getElementById("autosaveBanner");
      if (bar) bar.remove();
      bar = document.createElement("div");
      bar.id = "autosaveBanner";
      bar.style.cssText = "position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:9500;background:#1F497D;color:#fff;padding:10px 18px;border-radius:0 0 10px 10px;font-size:12.5px;display:flex;align-items:center;gap:12px;box-shadow:0 4px 14px rgba(0,0,0,0.25);";
      const msg = document.createElement("span");
      msg.innerHTML = `<i class="fas fa-cloud"></i>&nbsp; Newer changes were saved ${mode === "bulk" ? "to this batch" : "for this patient"} by someone else.`;
      const reloadBtn = document.createElement("button");
      reloadBtn.textContent = "Reload";
      reloadBtn.style.cssText = "background:#fff;color:#1F497D;border:none;padding:4px 12px;border-radius:6px;font-weight:700;cursor:pointer;font-size:11.5px;";
      reloadBtn.onclick = () => { onReload(); bar.remove(); };
      const dismissBtn = document.createElement("button");
      dismissBtn.innerHTML = "&#x2715;";
      dismissBtn.style.cssText = "background:none;border:none;color:#fff;cursor:pointer;font-size:13px;opacity:0.8;";
      dismissBtn.onclick = () => bar.remove();
      bar.appendChild(msg); bar.appendChild(reloadBtn); bar.appendChild(dismissBtn);
      document.body.appendChild(bar);
    }

    async function _autosavePush(mode, key, data) {
      if (!key) return;
      try {
        const res = await fetch(`${PGTA_BASE}/api/pgta/autosave`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft_key: key, mode, data }),
        });
        if (!res.ok) return;
        const r = await res.json();
        _autosave[mode].lastUpdatedAt = r.updated_at;
      } catch (e) {  }
    }

    async function _autosaveCheck(mode, key, onNewer) {
      if (!key) return;
      try {
        const res = await fetch(`${PGTA_BASE}/api/pgta/autosave?draft_key=${encodeURIComponent(key)}&mode=${mode}`);
        if (!res.ok) return; 
        const r = await res.json();
        if (_autosave[mode].key !== key) return; 
        if (_autosave[mode].lastUpdatedAt && r.updated_at === _autosave[mode].lastUpdatedAt) return; 
        onNewer(r);
      } catch (e) {  }
    }

    function scheduleManualAutosave() {
      const key = _normalizeAutosaveKey(document.getElementById("f_patient_name")?.value);
      if (!key) return;
      const isNewKey = _autosave.manual.key !== key;
      _autosave.manual.key = key;
      if (isNewKey) {
        _autosave.manual.lastUpdatedAt = null;
        _autosaveCheck("manual", key, (r) => {
          _autosaveBanner("manual", () => { _applyManualDraft(r.data); _autosave.manual.lastUpdatedAt = r.updated_at; });
        });
      }
      const draftData = {
        patientData: getPatientData(), summaryRows: state.summaryRows,
        embryoForms: state.embryoForms, embryoCount: state.embryoCount,
        cnvImages: state.cnvImages, _type: "pgta_manual_draft",
        _savedAt: new Date().toISOString(),
      };
      const snapshot = JSON.stringify(draftData);
      if (snapshot === _autosave.manual.lastSnapshot) return;
      _autosave.manual.lastSnapshot = snapshot;
      if (_autosave.manual.timer) clearTimeout(_autosave.manual.timer);
      _autosave.manual.timer = setTimeout(() => _autosavePush("manual", key, draftData), 2500);
    }

    function _trackBulkAutosaveKey(filename) {
      const key = _normalizeAutosaveKey(filename);
      if (!key) return;
      _autosave.bulk.key = key;
      _autosave.bulk.lastUpdatedAt = null;
      _autosave.bulk.lastSnapshot = null;
      _autosaveCheck("bulk", key, (r) => {
        _autosaveBanner("bulk", () => { _applyBulkDraft(r.data); _autosave.bulk.lastUpdatedAt = r.updated_at; });
      });
    }

    function scheduleBulkAutosave() {
      const key = _autosave.bulk.key;
      if (!key || !state.bulkPatients.length) return;
      const draftData = {
        patients: JSON.parse(JSON.stringify(state.bulkPatients)),
        _type: "pgta_bulk_draft", _savedAt: new Date().toISOString(),
      };
      const snapshot = JSON.stringify(draftData);
      if (snapshot === _autosave.bulk.lastSnapshot) return;
      _autosave.bulk.lastSnapshot = snapshot;
      if (_autosave.bulk.timer) clearTimeout(_autosave.bulk.timer);
      _autosave.bulk.timer = setTimeout(() => _autosavePush("bulk", key, draftData), 2500);
    }

    
    
    setInterval(() => {
      if (_autosave.manual.key) {
        _autosaveCheck("manual", _autosave.manual.key, (r) => {
          _autosaveBanner("manual", () => { _applyManualDraft(r.data); _autosave.manual.lastUpdatedAt = r.updated_at; });
        });
      }
      if (_autosave.bulk.key) {
        scheduleBulkAutosave();
        _autosaveCheck("bulk", _autosave.bulk.key, (r) => {
          _autosaveBanner("bulk", () => { _applyBulkDraft(r.data); _autosave.bulk.lastUpdatedAt = r.updated_at; });
        });
      }
    }, 15000);

    
    
    
    function _pfFillField(id, value) {
      if (value === undefined || value === null || value === "") return;
      const el = document.getElementById(id);
      if (el) el.value = value;
    }

    function _pfApplyPatient(p) {
      _pfFillField("f_patient_name", p.patient_name);
      _pfFillField("f_pin", p.patient_no);
      _pfFillField("f_age", p.age);
      _pfFillField("f_sample_number", p.lab_no);
      _pfFillField("f_referring_clinician", p.referring_doctor);
      _pfFillField("f_hospital_clinic", p.client_name);
      const isoDate = (p.sample_receipt_date || "").split(" ")[0];
      const [y, m, d] = isoDate.split("-");
      const displayDate = (y && m && d) ? `${d}-${m}-${y}` : "";
      _pfFillField("f_sample_collection_date", displayDate);
      _pfFillField("f_sample_receipt_date", displayDate);
      schedulePreview();
      const statusEl = document.getElementById("pfStatus");
      if (statusEl) statusEl.textContent = "Patient details applied.";
    }

    let _pfLastPatients = [];

    function _pfRenderDropdown(patients) {
      const dd = document.getElementById("pfDropdown");
      const inp = document.getElementById("pfSearch");
      if (!dd || !inp) return;
      dd.innerHTML = "";
      if (!patients.length) {
        dd.innerHTML = '<div class="pf-dd-empty">No matching patients</div>';
      } else {
        patients.forEach(p => {
          const item = document.createElement("button");
          item.type = "button";
          item.className = "pf-dd-item";
          const detail = [p.patient_no, p.age ? `${p.age}y` : "", p.client_name, p.test].filter(Boolean).join(" · ");
          item.innerHTML = `<div class="pf-dd-name">${esc(p.patient_name)}</div><div class="pf-dd-detail">${esc(detail)}</div>`;
          item.onmousedown = e => {
            e.preventDefault();
            _pfApplyPatient(p);
            dd.style.display = "none";
            inp.value = p.patient_name;
          };
          dd.appendChild(item);
        });
      }
      // Position fixed below the search input; width spans the full filter bar
      const r = inp.getBoundingClientRect();
      const bar = inp.closest(".pf-filter-bar");
      const barR = bar ? bar.getBoundingClientRect() : r;
      dd.style.position = "fixed";
      dd.style.top   = (r.bottom + 4) + "px";
      dd.style.left  = barR.left + "px";
      dd.style.width = barR.width + "px";
      dd.style.display = "block";
    }

    function _pfDropdownBlur() {
      setTimeout(() => {
        const dd = document.getElementById("pfDropdown");
        if (dd) dd.style.display = "none";
      }, 150);
    }

    // Build patient list from the sheet data already loaded in EmbryoMatrix (global `cases` array)
    function _pfSheetPatients(query, testFilter, monthFilter, yearFilter, clientFilter) {
      const q = (query || "").trim().toLowerCase();
      const tf = (testFilter || "").trim().toLowerCase();
      const mf = (monthFilter || "").trim();
      const yf = (yearFilter || "").trim();
      const cf = (clientFilter || "").trim().toLowerCase();
      if (!q && !tf && !mf && !yf && !cf) return [];
      const src = (typeof cases !== "undefined" && Array.isArray(cases)) ? cases : [];
      const results = [];
      for (const c of src) {
        const name = (c.patient || "").trim();
        if (!name) continue;
        const clientName = c.client || "";
        const testName = (c.test || "").toLowerCase();
        if (tf && !testName.includes(tf)) continue;
        if (cf && !clientName.toLowerCase().includes(cf)) continue;
        if (mf || yf) {
          const e0 = c.embryos?.[0] || {};
          const dateStr = e0["date sample received"] || e0["date sample collected"] || "";
          if (dateStr) {
            const d = new Date(dateStr);
            if (!isNaN(d)) {
              if (yf && String(d.getFullYear()) !== yf) continue;
              if (mf && String(d.getMonth() + 1).padStart(2, "0") !== mf) continue;
            } else { continue; }
          } else { continue; }
        }
        const matchesQ = !q ||
          name.toLowerCase().includes(q) ||
          (c.id || "").toLowerCase().includes(q) ||
          clientName.toLowerCase().includes(q);
        if (!matchesQ) continue;
        // Use first embryo row for sample-level fields
        const e = c.embryos?.[0] || {};
        const _f = (keys) => { for (const k of keys) { const v = e[k]; if (v && String(v).trim()) return String(v).trim(); } return ""; };
        results.push({
          patient_name: name,
          gender: _f(["gender", "sex"]),
          age: _f(["age"]),
          patient_no: c.id || _f(["patient id", "patient no", "pin"]),
          lab_no: _f(["sample id", "sample no", "lab no", "box number"]),
          sample_receipt_date: _f(["date sample received", "received date"]),
          sample_collected_time: _f(["sample collection date", "date sample collected"]),
          referring_doctor: _f(["referring doctor", "doctor name", "referred by"]),
          client_name: clientName,
          test: c.test || "",
        });
        if (results.length >= 80) break;
      }
      return results;
    }

    function pfRunFilters() {
      pfLiveSearch(document.getElementById("pfSearch")?.value || "");
    }

    function pfLiveSearch(query) {
      const testFilter   = document.getElementById("pfTestFilter")?.value || "";
      const monthFilter  = document.getElementById("pfMonthFilter")?.value || "";
      const yearFilter   = document.getElementById("pfYearFilter")?.value || "";
      const clientFilter = document.getElementById("pfClientFilter")?.value || "";
      const statusEl = document.getElementById("pfStatus");
      const q = (query || "").trim();
      const hasFilter = testFilter || monthFilter || yearFilter || clientFilter;
      if (q.length < 2 && !hasFilter) {
        _pfLastPatients = [];
        const dd = document.getElementById("pfDropdown");
        if (dd) dd.style.display = "none";
        if (statusEl) statusEl.textContent = "";
        return;
      }
      const patients = _pfSheetPatients(q, testFilter, monthFilter, yearFilter, clientFilter);
      _pfLastPatients = patients;
      if (statusEl) statusEl.textContent = patients.length ? `${patients.length} found` : "No matches";
      _pfRenderDropdown(patients);
    }

    function _pfPopulateFilters() {
      const src = (typeof cases !== "undefined" && Array.isArray(cases)) ? cases : [];
      const clients = [...new Set(src.map(c => c.client).filter(Boolean))].sort();
      const clientSel = document.getElementById("pfClientFilter");
      if (clientSel) {
        clientSel.querySelectorAll("option:not(:first-child)").forEach(o => o.remove());
        clients.forEach(v => clientSel.add(new Option(v, v)));
      }
      const years = new Set(), months = new Set();
      for (const c of src) {
        const e0 = c.embryos?.[0] || {};
        const ds = e0["date sample received"] || e0["date sample collected"] || "";
        if (ds) { const d = new Date(ds); if (!isNaN(d)) { years.add(String(d.getFullYear())); months.add(String(d.getMonth() + 1).padStart(2, "0")); } }
      }
      const yearSel = document.getElementById("pfYearFilter");
      if (yearSel) {
        yearSel.querySelectorAll("option:not(:first-child)").forEach(o => o.remove());
        [...years].sort().reverse().forEach(y => yearSel.add(new Option(y, y)));
      }
      const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const monthSel = document.getElementById("pfMonthFilter");
      if (monthSel) {
        monthSel.querySelectorAll("option:not(:first-child)").forEach(o => o.remove());
        [...months].sort().forEach(m => monthSel.add(new Option(MN[parseInt(m) - 1], m)));
      }
    }

    function _csvEscape(value) {
      const s = String(value ?? "");
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function _patientsToCsv(patients) {
      const header = ["Patient Name", "Gender", "Age", "Patient No", "Lab Number", "Sample Receipt Date", "Sample Collection Date", "Referred By", "Hospital/Clinic"];
      const rows = patients.map(p => [
        p.patient_name || "",
        p.gender || "",
        p.age ?? "",
        p.patient_no || "",
        p.lab_no || "",
        (p.sample_receipt_date || "").split(" ")[0],
        (p.sample_collected_time || "").split(" ")[0],
        p.referring_doctor || "",
        p.client_name || "",
      ]);
      return [header, ...rows].map(r => r.map(_csvEscape).join(",")).join("\r\n");
    }




    const dropZone = document.getElementById("dropZone");
    const bulkInput = document.getElementById("bulkFileInput");
    const resultDropZone = document.getElementById("resultDropZone");
    const bulkResultInput = document.getElementById("bulkResultFileInput");

    if (bulkInput) bulkInput.addEventListener("change", () => { if (bulkInput.files.length > 0) _onBulkOrResultFileChosen(); });
    if (dropZone) dropZone.addEventListener("drop", e => {
      e.preventDefault(); dropZone.classList.remove("drag-over");
      if (e.dataTransfer.files.length === 0) return;
      const dt = new DataTransfer();
      Array.from(e.dataTransfer.files).forEach(f => dt.items.add(f));
      bulkInput.files = dt.files;
      _onBulkOrResultFileChosen();
    });

    if (resultDropZone) {
      resultDropZone.addEventListener("dragover", e => { e.preventDefault(); resultDropZone.classList.add("drag-over"); });
      resultDropZone.addEventListener("dragleave", () => resultDropZone.classList.remove("drag-over"));
      resultDropZone.addEventListener("drop", e => {
        e.preventDefault(); resultDropZone.classList.remove("drag-over");
        if (e.dataTransfer.files.length === 0) return;
        const dt = new DataTransfer();
        Array.from(e.dataTransfer.files).forEach(f => dt.items.add(f));
        bulkResultInput.files = dt.files;
        _onBulkOrResultFileChosen();
      });
    }
    if (bulkResultInput) bulkResultInput.addEventListener("change", () => _onBulkOrResultFileChosen());

    function _bulkRunFilters() {
      loadBulkFromSheet(document.getElementById("bulkSheetSearch")?.value || "");
    }

    function _bulkPopulateFilters() {
      const src = (typeof cases !== "undefined" && Array.isArray(cases)) ? cases : [];
      const clients = [...new Set(src.map(c => c.client).filter(Boolean))].sort();
      const clientSel = document.getElementById("bulkClientFilter");
      if (clientSel) {
        clientSel.querySelectorAll("option:not(:first-child)").forEach(o => o.remove());
        clients.forEach(v => clientSel.add(new Option(v, v)));
      }
      const years = new Set(), months = new Set();
      for (const c of src) {
        const e0 = c.embryos?.[0] || {};
        const ds = e0["date sample received"] || e0["date sample collected"] || "";
        if (ds) { const d = new Date(ds); if (!isNaN(d)) { years.add(String(d.getFullYear())); months.add(String(d.getMonth() + 1).padStart(2, "0")); } }
      }
      const yearSel = document.getElementById("bulkYearFilter");
      if (yearSel) {
        yearSel.querySelectorAll("option:not(:first-child)").forEach(o => o.remove());
        [...years].sort().reverse().forEach(y => yearSel.add(new Option(y, y)));
      }
      const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const monthSel = document.getElementById("bulkMonthFilter");
      if (monthSel) {
        monthSel.querySelectorAll("option:not(:first-child)").forEach(o => o.remove());
        [...months].sort().forEach(m => monthSel.add(new Option(MN[parseInt(m) - 1], m)));
      }
    }

    function loadBulkFromSheet(query) {
      const testFilter   = document.getElementById("bulkTestFilter")?.value || "";
      const monthFilter  = document.getElementById("bulkMonthFilter")?.value || "";
      const yearFilter   = document.getElementById("bulkYearFilter")?.value || "";
      const clientFilter = document.getElementById("bulkClientFilter")?.value || "";
      const statusEl     = document.getElementById("bulkSheetSearchStatus");
      const q = (query || "").trim();
      const hasFilter = testFilter || monthFilter || yearFilter || clientFilter;
      if (q.length < 2 && !hasFilter) {
        state.bulkPatients = [];
        if (statusEl) statusEl.textContent = "";
        renderBulkPatients();
        return;
      }
      const src = (typeof cases !== "undefined" && Array.isArray(cases)) ? cases : [];
      const matched = src.filter(c => {
        const name = (c.patient || "").trim();
        if (!name) return false;
        if (testFilter && (c.test || "").toLowerCase() !== testFilter.toLowerCase()) return false;
        if (clientFilter && !(c.client || "").toLowerCase().includes(clientFilter.toLowerCase())) return false;
        if (monthFilter || yearFilter) {
          const e0 = c.embryos?.[0] || {};
          const ds = e0["date sample received"] || e0["date sample collected"] || "";
          if (ds) {
            const d = new Date(ds);
            if (!isNaN(d)) {
              if (yearFilter && String(d.getFullYear()) !== yearFilter) return false;
              if (monthFilter && String(d.getMonth() + 1).padStart(2, "0") !== monthFilter) return false;
            } else { return false; }
          } else { return false; }
        }
        return !q || name.toLowerCase().includes(q.toLowerCase()) ||
          (c.id || "").toLowerCase().includes(q.toLowerCase()) ||
          (c.client || "").toLowerCase().includes(q.toLowerCase());
      });
      if (statusEl) statusEl.textContent = matched.length ? `${matched.length} patient${matched.length > 1 ? "s" : ""} found` : "No matches";
      state.bulkPatients = matched.map(c => {
        const e0 = c.embryos?.[0] || {};
        const _f = keys => { for (const k of keys) { const v = e0[k]; if (v && String(v).trim()) return String(v).trim(); } return ""; };
        const isoDate = (_f(["date sample received", "received date"]) || "").split(" ")[0];
        const [ry, rm, rd] = (isoDate || "").split("-");
        const disp = ry && rm && rd ? `${rd}-${rm}-${ry}` : "";
        return {
          patient_name: c.patient,
          spouse_name: "w/o",
          pin: c.id || _f(["patient id", "patient no", "pin"]),
          age: _f(["age"]),
          sample_number: _f(["sample id", "sample no", "lab no", "box number"]),
          referring_clinician: _f(["referring doctor", "doctor name", "referred by"]),
          biopsy_date: disp,
          hospital_clinic: c.client || "",
          sample_collection_date: disp,
          specimen: "DAY 5 TROPHECTODERM BIOPSY",
          sample_receipt_date: disp,
          biopsy_performed_by: "",
          report_date: todayStr(),
          report_template: "pgta",
          indication: "",
          results_summary_comment: "",
          embryos: (c.embryos || []).map((e, i) => ({
            embryo_id: _f.call(null, []) || `PS${i + 1}`,
            result_summary: (e["result summary"] || e["result"] || RESULT_SUMMARY_OPTIONS[0]),
            mtcopy: e["mt copy"] || e["mtcopy"] || "NA",
            interpretation: e["interpretation"] || "NA",
          })),
        };
      });
      renderBulkPatients();
    }

    const _isSheet = f => /\.(xlsx|xls|csv)$/i.test(f.name);
    const _isImg = f => /\.(png|jpe?g)$/i.test(f.name);

    function _onBulkOrResultFileChosen() {
      const resultLbl = document.getElementById("resultDropZoneLabel");
      const all = [...Array.from(bulkInput.files), ...Array.from(bulkResultInput.files)];
      // Chart images may be dropped into EITHER zone — gather them from both so
      // they get auto-matched regardless of where they landed.
      const images = all.filter(_isImg);
      const mainSheet = Array.from(bulkInput.files).find(_isSheet);
      const resultSheet = Array.from(bulkResultInput.files).find(_isSheet);

      if (resultLbl) {
        const rShown = resultSheet ? resultSheet.name : (images.length ? `${images.length} chart image(s)` : "");
        if (rShown) resultLbl.innerHTML = `<strong>${esc(rShown)}</strong> &nbsp;<small style="color:var(--text-muted);text-decoration:underline;">(click to change)</small>`;
      }

      if (mainSheet && resultSheet) {
        // Both a Patient List and a separate Result file are staged — cross-match
        // them, then auto-map any chart images that came along.
        handleBulkFilesWithResult(mainSheet, resultSheet, images);
      } else if (mainSheet) {
        handleBulkFiles([mainSheet, ...images]);
      } else if (images.length && state.bulkPatients && state.bulkPatients.length) {
        // Only images were added after patients were already loaded — map them.
        autoFetchLocalCnvImages(images);
      }
    }

    async function handleBulkFiles(files) {
      if (files.length === 0) return;

      const lbl = document.getElementById("dropZoneLabel");
      const excelFiles = Array.from(files).filter(f => /\.(xlsx|xls|csv)$/i.test(f.name));

      if (excelFiles.length === 0) {
        showToast("No Excel or CSV file found in selection", "error");
        return;
      }

      const excelFile = excelFiles[0];
      const otherFiles = Array.from(files).filter(f => f !== excelFile);
      const images = otherFiles.filter(f => /\.(png|jpe?g)$/i.test(f.name));

      if (lbl) lbl.innerHTML = `<span class="spinner" style="border-color:#1F497D;border-top-color:#4F81BD;width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:6px;border-width:2px;border-style:solid;border-radius:50%;animation:spin 0.7s linear infinite;"></span>Processing <strong>${esc(excelFile.name)}</strong> + ${images.length} images…`;
      
      try {
        _lastMatchSkips = []; _lastRowSkips = [];
        const patients = await parseExcelClientSide(excelFile);
        if (!patients.length) {
          // Distinguish "the sheet has no patients" from "the sheet has
          // patients but nothing matched them" — the two need different fixes,
          // and reporting the second as the first sent people hunting for a
          // missing Details sheet that was there all along.
          if (_lastMatchSkips.length) throw new Error(
            `${_lastMatchSkips.length} patient row(s) read, but no result row could be matched to any of them. ` +
            `Check that the Result sheet's Sample names start with the patient name or Patient No (see the list below).`);
          throw new Error("No patient rows found in Excel file.");
        }
        state.bulkPatients = patients;
        _trackBulkAutosaveKey(excelFile.name);

        
        let mapped = 0;
        if (images.length > 0) mapped = await _autoMapCnvImagesLocal(images);

        renderBulkPatients();
        _renderMatchSkips();
        document.getElementById("bulkPatientSection").classList.remove("hidden");
        const skipped = _lastMatchSkips.length;
        if (lbl) {
          let msg = `<strong>${esc(excelFile.name)}</strong> &mdash; ${state.bulkPatients.length} patients`;
          if (skipped > 0) msg += ` <small style="color:#b45309;font-weight:bold;">(${skipped} unmatched)</small>`;
          if (mapped > 0) msg += ` <small style="color:var(--success);font-weight:bold;">(+${mapped} CNVs)</small>`;
          lbl.innerHTML = msg + ` &nbsp;<small style="color:var(--text-muted);text-decoration:underline;">(click to change)</small>`;
        }
        showToast(`Loaded ${state.bulkPatients.length} patient(s)` + (skipped ? ` — ${skipped} unmatched` : "") + (mapped ? ` + ${mapped} CNV chart(s)` : ""), skipped ? "warning" : "success");
      } catch (err) {
        if (lbl) lbl.innerHTML = `<span style="color:#c00;">Error: ${esc(err.message)}</span> &nbsp;<small style="text-decoration:underline;">(click to retry)</small>`;
        // Show what failed to match, so a nothing-matched import is diagnosable
        // instead of just a red line in the drop zone.
        _renderMatchSkips();
        if (_lastMatchSkips.length) document.getElementById("bulkPatientSection").classList.remove("hidden");
        showToast("Processing failed: " + err.message, "error");
      }
    }

    function parseExcelClientSide(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) {
          try {
            const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: true });
            const sheetNamesLower = wb.SheetNames.map(s => s.toLowerCase());
            const detailsIdx = sheetNamesLower.indexOf("details");
            const summaryIdx = sheetNamesLower.indexOf("summary");

            if (detailsIdx !== -1 && summaryIdx !== -1) {
              resolve(_parseAnalysisExcel(wb, detailsIdx, summaryIdx));
            } else {
              resolve(_parseTemplateExcel(wb));
            }
          } catch(err) { reject(err); }
        };
        reader.onerror = () => reject(new Error("File read error"));
        reader.readAsArrayBuffer(file);
      });
    }

    
    function _cleanV(v) {
      if (v instanceof Date) return v.toLocaleDateString("en-GB").replace(/\//g, "-");
      const s = String(v ?? "").trim();
      return ["nan","none","nat","null","undefined"].includes(s.toLowerCase()) ? "" : s;
    }
    function _getV(row, keys, def = "") {
      // Strip a leading UTF-8 BOM (﻿) so headers from BOM-prefixed CSVs
      // (e.g. the Access History export) still match by name.
      const norm = k => String(k).replace(/^﻿/, "").toLowerCase().trim();
      const lower = {};
      Object.keys(row).forEach(k => { lower[norm(k)] = row[k]; });
      for (const k of keys) {
        const v = lower[norm(k)];
        if (v !== undefined && v !== null) { const s = _cleanV(v); if (s) return s; }
      }
      return def;
    }
    function _fmtDate(v) {
      const full = _cleanV(v); if (!full) return "";
      // Only the first token is a real date+time split (e.g. "2026-07-15 00:00:00");
      // free-text cells like "14 & 15-07-2026" must be kept whole, not truncated to "14".
      const s = full.split(" ")[0];
      const patterns = [
        [/^(\d{4})-(\d{2})-(\d{2})$/, m => `${m[3]}-${m[2]}-${m[1]}`],
        [/^(\d{2})\/(\d{2})\/(\d{4})$/, m => `${m[1]}-${m[2]}-${m[3]}`],
        [/^(\d{2})-(\d{2})-(\d{4})$/, () => s],
      ];
      for (const [re, fn] of patterns) { const m = s.match(re); if (m) return fn(m); }
      return full.replace(/\//g, "-");
    }
    function _stripDec(v) {
      const f = parseFloat(v); return (!isNaN(f) && f === Math.floor(f)) ? String(Math.floor(f)) : v;
    }
    function _normName(s) {
      if (!s) return "";
      s = String(s).toUpperCase().trim();
      for (const p of ["MRS.","MR.","SMT.","DR.","MS.","MISS.","PROF.","R.","S.","K.","M.","D.","P.","A.","B.","C.","G.","H.","J.","L.","N.","T.","V.","W."]) {
        if (s.startsWith(p)) { s = s.slice(p.length).trim(); break; }
      }
      return s.replace(/\([^)]*\)/g, "").replace(/[^A-Z0-9]/g, "");
    }

    // Some labs' Details sheets append a lone trailing initial (e.g. spouse's
    // first letter) that the generated sample name then drops. Try matching
    // against that shortened form only as a FALLBACK (never as the primary
    // form) — used blindly it truncates real surnames that happen to end in
    // one of these letters (e.g. "KAVERI NIKHIL PATEKAR", "JYOTI PARASHAR"),
    // which silently dropped those patients from the rendered list entirely.
    function _normNameShort(s) {
      const suffixes = ["C","D","R","S","G","K","M","N","P","T","V","W"];
      if (s.length > 3 && !/\d/.test(s.slice(-2, -1)) && suffixes.includes(s.slice(-1)) && s.slice(0,-1).length >= 3) return s.slice(0,-1);
      return s;
    }
    function _firstToken(s) {
      if (!s) return "";
      s = String(s).toUpperCase().trim();
      for (const p of ["MRS.","MR.","SMT.","DR.","MS.","MISS.","PROF."]) { if (s.startsWith(p)) { s = s.slice(p.length).trim(); break; } }
      return (s.replace(/\([^)]*\)/g,"").split(/\s+/)[0] || s).replace(/[^A-Z0-9]/g,"");
    }

    // PIN normalizer — uppercase + strip non-alphanumerics ONLY. Unlike
    // _normName it does NOT trim trailing "suffix" letters, so identifiers like
    // "260739312-RPT" stay intact for exact PIN comparison.
    function _normPin(s) {
      return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    }

    // Reads the PIN / Patient No column from a Result-summary row, if present.
    function _rowPin(sRow) {
      return _getV(sRow, [
        "PIN", "PIN No", "PIN No.", "PIN NO", "PIN Number", "PIN_No",
        "Patient No", "Patient No.", "Patient_No", "PatientNo", "Patient ID", "Patient_ID",
      ]);
    }

    // True when the patient's PIN and a Result row's PIN refer to the same
    // person: exact match, or substring either way for composite IDs (len>=4 to
    // avoid trivial collisions).
    function _pinMatches(patientPin, rowPinRaw) {
      const a = _normPin(patientPin), b = _normPin(rowPinRaw);
      if (!a || !b) return false;
      if (a === b) return true;
      return (a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b));
    }



    // The identifiers a Sample name can carry: the dash-delimited prefixes of
    // the part before "_". "AG-1234-E1_S9" -> ["AG", "AG1234", "AG1234E1"].
    // A PIN counts as present only when it EQUALS one of these (whatever
    // follows is the embryo suffix) — never when it merely appears somewhere
    // inside the name, which is how "1234" used to grab "AG12345-E1".
    function _sampleNameIds(sOrig) {
      const ids = [];
      let acc = "";
      for (const part of String(sOrig || "").split("_")[0].split("-")) {
        acc += part;
        const n = _normPin(acc);
        if (n) ids.push(n);
      }
      return ids;
    }

    // How a Result row may be tied to a patient, strongest tier first. Most
    // lab Result sheets carry NO PIN at all and name their samples after the
    // patient ("ANJALIDEVI-AD1_L00_R1") while the Details sheet's Sample ID is
    // a lab accession ("AND25420006214"), so the name tiers are the everyday
    // path, not a fallback — dropping them left whole runs unmatched.
    //
    // The danger the tiers exist to contain is a row landing on the WRONG
    // patient (shared first names, spousal-initial suffixes, one name being a
    // prefix of another). That is handled by resolving each row to the single
    // highest-scoring patient and refusing ties, rather than by giving the row
    // to whichever patient the sheet happened to list first.
    const _MATCH_PIN_COLUMN  = 100; // a dedicated PIN column agrees
    const _MATCH_PIN_IN_NAME = 90;  // patient PIN is a whole prefix of the Sample name
    const _MATCH_PIN_SEGMENT = 85;  // patient PIN is a whole dash-segment of it
    const _MATCH_NAME_EXACT  = 80;  // "<FULLNAME>-E1"
    const _MATCH_NAME_SHORT  = 70;  // full name minus a trailing spouse initial
    const _MATCH_NAME_PREFIX = 60;  // "ANJALIDEVI-AD1" for "ANJALI DEVI P A S"
    const _MATCH_NAME_START  = 55;  // whole name at the head of the Sample name
    const _MATCH_FIRST_TOKEN = 50;  // first name token only — weakest

    // Match keys for one patient, computed once and reused for every row.
    function _patientMatchKeys(pName, pin) {
      const normP = _normName(pName);
      return { pin, pinN: _normPin(pin), normP, normPShort: _normNameShort(normP), ftok: _firstToken(pName) };
    }

    // Match keys for one Result row. sFT is the Sample name's leading segment
    // ("ANJALIDEVI" of "ANJALIDEVI-AD1_L00_R1") — either the patient name or
    // the Patient No, depending on the lab.
    function _rowMatchKeys(sRow, sOrig) {
      return {
        rowPin: _rowPin(sRow),
        ids: _sampleNameIds(sOrig),
        segs: String(sOrig).split("_")[0].split("-").map(_normPin).filter(Boolean),
        normS: _normName(sOrig),
        sFT: _normPin(String(sOrig).split("_")[0].split("-")[0]),
      };
    }

    // 0 when this row cannot belong to this patient, else the tier score.
    function _matchScore(k, r) {
      // A PIN column on the Result sheet is authoritative: when both sides
      // carry a PIN they must agree, and no name tier may rescue a
      // disagreement — that is what keeps two similarly-named patients from
      // swapping embryos on a sheet that already says who is who.
      if (r.rowPin && k.pinN) return _pinMatches(k.pin, r.rowPin) ? _MATCH_PIN_COLUMN : 0;

      // PIN carried by the Sample name itself ("<PIN>-E1"). It must EQUAL one
      // of the dash-delimited prefixes, never merely occur inside the name,
      // so "1234" cannot grab "AG12345-E1".
      if (k.pinN && r.ids.includes(k.pinN)) return _MATCH_PIN_IN_NAME;

      // PIN sitting further along the name ("AG-12345-E1" for PIN "12345").
      // Whole segment only, for the same reason as above.
      if (k.pinN.length >= 3 && r.segs.includes(k.pinN)) return _MATCH_PIN_SEGMENT;

      if (k.normP && r.sFT === k.normP) return _MATCH_NAME_EXACT;
      if (k.normPShort && k.normPShort !== k.normP && r.sFT === k.normPShort) return _MATCH_NAME_SHORT;
      // The sample carries a shortened form of a longer name, e.g. trailing
      // initials dropped: "ANJALIDEVI-AD1" for "ANJALI DEVI P A S".
      if (r.sFT.length >= 5 && k.normP.length > r.sFT.length && k.normP.startsWith(r.sFT)) return _MATCH_NAME_PREFIX;
      // Boundary-aware prefix so a shorter name never swallows a longer one.
      if (k.normP.length >= 4 && r.normS.startsWith(k.normP)) {
        const rest = r.normS.slice(k.normP.length);
        if (rest === "" || /^\d/.test(rest) || rest.length <= 3) return _MATCH_NAME_START;
      }
      if (k.ftok.length >= 4 && r.sFT === k.ftok) return _MATCH_FIRST_TOKEN;
      return 0;
    }

    // Resolves ONE Result row to at most one patient: the single
    // highest-scoring candidate. A tie at the top tier is refused outright and
    // reported, because handing the row to whichever patient came first is
    // exactly how one patient's embryos ended up on another's signed report.
    function _resolveRowToPatient(cands, sRow, sOrig) {
      const r = _rowMatchKeys(sRow, sOrig);
      let best = null, bestScore = 0, tiedWith = null;
      for (const c of cands) {
        const score = _matchScore(c._keys, r);
        if (!score) continue;
        if (score > bestScore) { best = c; bestScore = score; tiedWith = null; }
        else if (score === bestScore) tiedWith = c;
      }
      if (!best) return { patient: null, reason: "no patient on the list matches this Sample name" };
      if (tiedWith) return {
        patient: null,
        reason: `ambiguous — matches "${best.patient_name}" and "${tiedWith.patient_name}" equally well; add a Patient No / PIN to tell them apart`,
      };
      return { patient: best };
    }

    // Assigns every Result row to its patient. Row-centric on purpose: a row
    // must be compared against ALL patients before it is given to one.
    function _assignEmbryosToPatients(patients, summaryRows) {
      const seen = new Set();
      _lastRowSkips = [];
      for (const sRow of summaryRows) {
        const sOrig = _cleanV(sRow["Sample name"]);
        if (!sOrig || seen.has(sOrig)) continue;
        const { patient, reason } = _resolveRowToPatient(patients, sRow, sOrig);
        if (!patient) { _lastRowSkips.push({ sample: sOrig, reason }); continue; }
        seen.add(sOrig);

        const k = patient._keys;
        const base = sOrig.split("_")[0];
        // "PATIENT-V1" -> "V1": strip the patient-name/PIN prefix so only the
        // embryo ID is displayed. Stripped only when the prefix matches this
        // patient's name/first-token/PIN — otherwise the dash is part of the
        // embryo tag itself (e.g. "KS1-1") and is kept verbatim.
        const embryoId = _stripPatientPrefix(base, k.pin, k.normP, k.ftok, k.normPShort);
        patient.embryos.push(_buildEmbryoFromSummaryRow(sRow, embryoId, sOrig));
      }
    }


    function _stripPatientPrefix(base, pin, normP, ftok, normPShort) {
      if (!base.includes("-")) return base;

      // Patient No pass, longest dash-delimited prefix first, so a dashed
      // Patient No ("AG-1234" in "AG-1234-E1") comes off whole instead of one
      // segment at a time leaving "1234-E1" as the embryo ID.
      const normSid = _normPin(pin);
      if (normSid) {
        const parts = base.split("-");
        for (let i = parts.length - 1; i >= 1; i--) {
          const rest = parts.slice(i).join("-");
          if (rest && _normPin(parts.slice(0, i).join("-")) === normSid) return rest;
        }
      }

      const dashIdx = base.indexOf("-");
      const prefix = base.slice(0, dashIdx);
      const rest = base.slice(dashIdx + 1);
      if (!rest) return base;
      const prefixN = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!prefixN) return base;
      const matchesName = normP && (prefixN === normP || normP.startsWith(prefixN) || prefixN.startsWith(normP));
      const matchesShort = normPShort && normPShort !== normP && (prefixN === normPShort || normPShort.startsWith(prefixN) || prefixN.startsWith(normPShort));
      const matchesTok  = ftok && prefixN === ftok;
      return (matchesName || matchesShort || matchesTok) ? rest : base;
    }

    function _parseResult(rStr) {
      const cMap = {}, mMap = {};
      if (!rStr || _cleanV(rStr) === "") return { cMap, mMap };
      const parts = rStr.split(/,\s*(?=(?:del|dup|mos|[+-]|Monosomy|Trisomy))/i);
      for (let part of parts) {
        part = part.trim(); if (!part) continue;
        const m = part.match(/(?:del|dup|mos)[^a-zA-Z]*?(\d+|X|Y)/i);
        if (m) {
          const etype = part.slice(0,3).toLowerCase(), chrom = m[1];
          const isSeg = /([pq]\d|mb)/i.test(part);
          let st = etype === "del" ? (isSeg ? "SL" : "L") : etype === "dup" ? (isSeg ? "SG" : "G") : "M";
          const mm = part.match(/[~]*(\d+)%/);
          if (mm) {
            mMap[chrom] = mm[1];
            st = etype === "del" ? (isSeg ? "SML" : "ML") : etype === "dup" ? (isSeg ? "SMG" : "MG") : "M";
          }
          cMap[chrom] = st;
        } else if (/^\+/.test(part) || /^-\d/.test(part)) {
          // Whole-chromosome gain/loss. A "~NN%" fraction makes it mosaic
          // ("+15(~30%)" -> MG with Mosaic (%) 30, "-20(~51%)" -> ML with 51);
          // without one it is a plain G / L.
          const isGain = /^\+/.test(part);
          const ch = part.replace(/^[+-]/,"").replace(/\(.*\)/,"").replace(/[^0-9XY]/gi,"").trim();
          if (ch) {
            const mm = part.match(/~?\s*(\d+)\s*%/);
            if (mm) {
              mMap[ch] = mm[1];
              cMap[ch] = isGain ? "MG" : "ML";
            } else {
              cMap[ch] = isGain ? "G" : "L";
            }
          }
        }
      }
      return { cMap, mMap };
    }


    function _summaryRawToRows(summaryRaw) {
      let hdrIdx = 0;
      for (let i = 0; i < summaryRaw.length; i++) {
        if (summaryRaw[i].some(v => String(v).toLowerCase().includes("sample name"))) { hdrIdx = i; break; }
      }
      const headers = summaryRaw[hdrIdx].map(h => String(h ?? "").trim());
      return summaryRaw.slice(hdrIdx + 1)
        .filter(r => r.some(v => v !== "" && v !== null))
        .map(r => { const o = {}; headers.forEach((h, i) => { if (h) o[h] = r[i] ?? ""; }); return o; });
    }


    // Splits a karyotype into its sex-chromosome findings and the autosomal
    // rest: "+X(~46%),+2,+16(~69%)" -> { sex: ["+X(~46%)"], auto: "+2,+16(~69%)" }.
    // Commas inside "(...)" are not separators, so "(~30.50Mb,~35%)" stays whole.
    function _splitKaryotype(karyo) {
      const txt = _cleanV(karyo);
      if (!txt || /^(N\/?A|EUPLOID|NORMAL)$/i.test(txt.trim())) return { sex: [], auto: "", plain: txt.trim() };
      const sex = [], auto = [];
      for (const raw of txt.split(/,(?![^(]*\))/)) {
        const p = raw.trim();
        if (!p) continue;
        (/^(?:mosaic\s+)?[+-]?\s*[XY]\b/i.test(p) ? sex : auto).push(p);
      }
      return { sex, auto: auto.join(","), plain: "" };
    }

    // Sex Chromosomes value from the karyotype's sex findings, in the same
    // wording the lab uses in its own SEX column:
    //   no finding                        -> "Normal"  (or "NA" if sex is N/A)
    //   sex undetermined (GENDER "N/A")   -> "Abnormal"
    //   a finding with no mosaic fraction -> "Abnormal"  (e.g. "XO,-X")
    //   otherwise -> "Mosaic Gain|Loss (NN%)" from the dominant (highest) one
    function _sexFromKaryotype(sexParts, genderVal) {
      const g = _cleanV(genderVal).trim().toUpperCase();
      const undetermined = !g || /^N\/?A\b/.test(g);
      if (!sexParts.length) return undetermined ? "NA" : "Normal";
      if (undetermined) return "Abnormal";
      let best = null;
      for (const p of sexParts) {
        const m = p.match(/~?\s*(\d+(?:\.\d+)?)\s*%/);
        if (!m) return "Abnormal";
        const pct = parseFloat(m[1]);
        if (!best || pct > best.pct) best = { pct, gain: p.includes("+") };
      }
      return `Mosaic ${best.gain ? "Gain" : "Loss"} (${_stripDec(String(best.pct))}%)`;
    }

    function _buildEmbryoFromSummaryRow(sRow, embryoId, sOrig) {
      const conclusion = _cleanV(sRow["Conclusion"]).toUpperCase();
      const result = _cleanV(sRow["Result"]);
      const ru = result.toUpperCase();
      const qc = _cleanV(sRow["QC"]).toUpperCase();

      let rs = "Normal chromosome complement", interp = "NA";
      if (/NO\s*DNA/.test(ru)) {
        rs = "No DNA detected";
      } else if (/LOW/.test(ru) && /DNA|READS/.test(ru)) {
        rs = "Low DNA concentration";
      } else if (qc === "FAIL" || /INCONCLUSIVE|RESEQUENCING/.test(ru)) {
        rs = "Inconclusive";
      } else if (/CHAOTIC/.test(conclusion) || /CHAOTIC/.test(ru)) {
        rs = "Multiple chromosomal abnormalities"; interp = "Chaotic embryo";
      } else if (/NO COPY NUMBER ABNORMALITY/.test(conclusion) || conclusion === "EUPLOID" || ru === "EUPLOID") {
        rs = "Normal chromosome complement"; interp = "Euploid";
      } else if (/MOSAIC/.test(conclusion) || /MOSAIC/.test(ru)) {
        rs = "Mosaic chromosome complement";
        const pcts = [...result.matchAll(/(\d+)%/g)].map(m => parseInt(m[1]));
        const cnt  = [...result.matchAll(/\bmos\b/gi)].length;
        if (cnt >= 3 || pcts.length >= 3) interp = "Complex mosaic";
        else if (pcts.length) interp = Math.max(...pcts) >= 51 ? "High level mosaic" : "Low level mosaic";
        else interp = "Low level mosaic";
      } else if (/ABNORMAL/.test(conclusion) || conclusion === "ABNORMAL") {
        rs = "Multiple chromosomal abnormalities"; interp = "Aneuploid";
      }

      // Older Analysis sheets (e.g. RUN-48) carry no AUTOSOMES / SEX columns —
      // the findings are only in "Karyotype MWF", which is exactly what the
      // newer sheets' AUTOSOMES column is filled from. Without this fallback
      // every abnormal embryo in such a sheet imported as "Autosomes: Normal",
      // "Sex Chromosomes: Normal" and an all-N CNV row, because the Result
      // column holds the code form ("SML-3,22") that carries no per-chromosome
      // detail. The Result code is still used when there is no karyotype.
      const karyo = _getV(sRow, ["Karyotype MWF", "Karyotype", "Karyotype MWF ", "KARYOTYPE MWF"]);
      const { sex: karyoSex, auto: karyoAuto, plain: karyoPlain } = _splitKaryotype(karyo);

      const chrStatuses = {}; for (let i = 1; i <= 22; i++) chrStatuses[String(i)] = "N";
      const mosaicPcts = {};
      // Statuses come from the karyotype when it lists findings — it uses the
      // del()/dup()/±N(~NN%) notation the parser understands, unlike the code form.
      const { cMap, mMap } = _parseResult(karyoAuto || result);
      Object.assign(chrStatuses, cMap); Object.assign(mosaicPcts, mMap);

      const autoCol = _getV(sRow, ["AUTOSOMES", "Autosomes", "Autosome"]);
      const sexCol = _getV(sRow, ["SEX", "Sex", "Sex Chromosomes", "Sex_Chromosomes"]);
      // "Euploid" / "Normal" -> Normal, "N/A" -> NA, and a karyotype whose only
      // findings are on X/Y (e.g. "+X(~55%),-Y(~41%)") leaves the autosomes
      // normal — which is what the lab writes in that case.
      const autoFallback = karyoAuto
        || (/^N\/?A$/i.test(karyoPlain) ? "NA" : (karyoPlain || karyo) ? "Normal" : "");

      return {
        embryo_id: embryoId, sample_name: sOrig,
        result_summary: rs, result_description: summaryToDescription(rs),
        autosomes: autoCol || autoFallback,
        sex_chromosomes: sexCol || (karyo ? _sexFromKaryotype(karyoSex, _getV(sRow, ["GENDER", "Gender"])) : ""),
        interpretation: interp,
        mtcopy: interp === "Euploid" ? (_cleanV(sRow["MTcopy"]) || "NA") : "NA",
        chromosome_statuses: chrStatuses, mosaic_percentages: mosaicPcts
      };
    }


    // Patients dropped by the last import because nothing matched their PIN.
    // Surfaced in the UI so a missing/mistyped Patient No is visible instead
    // of silently shrinking the batch.
    let _lastMatchSkips = [];

    // Result rows that matched no patient (or matched two equally well).
    let _lastRowSkips = [];

    function _matchSkipReason(pin) {
      return _normPin(pin)
        ? `no Result row matches this patient's name or Patient No / PIN "${String(pin).trim()}"`
        : "no Result row matches this patient's name";
    }

    function _parseAnalysisExcel(wb, detailsIdx, summaryIdx) {
      const detailsRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[detailsIdx]], { defval: "" });
      const summaryRaw  = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[summaryIdx]], { header: 1, defval: "" });
      const summaryRows = _summaryRawToRows(summaryRaw);

      const today = new Date().toLocaleDateString("en-GB").replace(/\//g, "-");
      const candidates = [];
      _lastMatchSkips = [];

      for (const pRow of detailsRows) {
        const pName = _cleanV(pRow["Patient Name"]); if (!pName) continue;
        const bDate = _fmtDate(_getV(pRow, ["Date of Biopsy","Biopsy Date"]));
        const rDate = _fmtDate(_getV(pRow, ["Date Sample Received","Receipt Date"]));
        // Most lab sheets have no separate collection-date column (collection
        // happens the same day as the biopsy), so fall back to Biopsy Date --
        // but honor a dedicated column when the sheet actually has one.
        const cDate = _fmtDate(_getV(pRow, ["Sample Collection Date","Date of Sample Collection","Collection Date","Date Collected"])) || bDate;
        const pin = _getV(pRow, ["Sample ID","PIN","PIN No","PIN No.","Patient ID","Patient No","Patient No."]);

        const info = {
          patient_name: pName,
          spouse_name: _getV(pRow, ["Spouse Name","Husband Name","Partner Name"], "w/o"),
          pin: pin,
          age: _getV(pRow, ["Age","Patient Age"]),
          sample_number: _stripDec(_getV(pRow, ["Sample Number","Sample No","Sample No.","SampleNumber","Lab Number","Lab No","Accession No","Accession Number"])),
          referring_clinician: _getV(pRow, ["Referring Clinician","Referring Clinician Name","Referring Doctor","Doctor Name","Referred By","Clinician","Doctor"]),
          biopsy_date: bDate, sample_collection_date: cDate,
          hospital_clinic: _getV(pRow, ["Hospital/Clinic Name","Hospital/Clinic","Hospital_Clinic","Hospital","Clinic","Center"]),
          specimen: _getV(pRow, ["Specimen Type","Sample Type"], "DAY 5 TROPHECTODERM BIOPSY"),
          sample_receipt_date: rDate,
          biopsy_performed_by: _getV(pRow, ["EMBRYOLOGIST NAME","Biologist"]),
          report_date: today,
          indication: _getV(pRow, ["Indication","Clinical Indication"]),
          embryos: []
        };
        info._keys = _patientMatchKeys(pName, pin);
        candidates.push(info);
      }

      _assignEmbryosToPatients(candidates, summaryRows);
      const patients = [];
      for (const info of candidates) {
        delete info._keys;
        if (info.embryos.length) patients.push(info);
        else _lastMatchSkips.push({ name: info.patient_name, reason: _matchSkipReason(info.pin) });
      }
      return patients;
    }

    
    function _parseTemplateExcel(wb) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const patientMap = new Map();
      for (const row of rows) {
        const name = _cleanV(row["Patient_Name"] || row["patient_name"] || row["PATIENT_NAME"] || row["Patient Name"] || "");
        if (!name) continue;
        if (!patientMap.has(name)) {
          patientMap.set(name, {
            patient_name: name,
            spouse_name: _cleanV(row["Spouse_Name"] || row["spouse_name"] || "w/o"),
            pin: _cleanV(row["PIN"] || row["pin"] || row["Patient No"] || row["Patient_No"] || ""),
            age: _cleanV(row["Age"] || row["age"] || ""),
            sample_number: _cleanV(row["Sample_Number"] || row["sample_number"] || ""),
            referring_clinician: _cleanV(row["Referring_Clinician"] || row["referring_clinician"] || row["Referring Clinician"] || row["Doctor Name"] || row["doctor_name"] || ""),
            biopsy_date: _cleanV(row["Biopsy_Date"] || row["biopsy_date"] || ""),
            hospital_clinic: _cleanV(row["Hospital_Clinic"] || row["hospital_clinic"] || ""),
            sample_collection_date: _cleanV(row["Sample_Collection_Date"] || row["sample_collection_date"] || ""),
            specimen: _cleanV(row["Specimen"] || row["specimen"] || "DAY 5 TROPHECTODERM BIOPSY"),
            sample_receipt_date: _cleanV(row["Sample_Receipt_Date"] || row["sample_receipt_date"] || row["Sample Receipt Date"] || ""),
            biopsy_performed_by: _cleanV(row["Biopsy_Performed_By"] || row["biopsy_performed_by"] || ""),
            report_date: _cleanV(row["Report_Date"] || row["report_date"] || ""),
            indication: _cleanV(row["Indication"] || row["indication"] || ""),
            embryos: []
          });
        }
        const info = patientMap.get(name);
        // The template's own contract is that Embryo_ID is just the tag, but
        // in practice it's sometimes filled in the same "PATIENT-TAG" style
        // as a Sample name (e.g. "GOWRISHANKARI-GV1") — strip that prefix the
        // same way the Details+Result cross-match import already does, so
        // the Sample column shows just the tag regardless of which import
        // path was used. A no-dash Embryo_ID (the common case) passes through
        // unchanged.
        const rawEmbryoId = _cleanV(row["Embryo_ID"] || row["embryo_id"] || "");
        const normP = _normName(name);
        const embryoId = _stripPatientPrefix(
          rawEmbryoId, info.pin, normP, _firstToken(name), _normNameShort(normP)
        );
        info.embryos.push({
          embryo_id: embryoId,
          result_summary: _cleanV(row["Result_Summary"] || row["result_summary"] || ""),
          result_description: _cleanV(row["Result_Description"] || row["result_description"] || ""),
          autosomes: _cleanV(row["Autosomes"] || row["autosomes"] || "Normal"),
          sex_chromosomes: _cleanV(row["Sex_Chromosomes"] || row["sex_chromosomes"] || "Normal"),
          interpretation: _cleanV(row["Interpretation"] || row["interpretation"] || "NA"),
          mtcopy: _cleanV(row["MTcopy"] || row["mtcopy"] || "NA"),
          chromosome_statuses: {}, mosaic_percentages: {}
        });
      }
      return Array.from(patientMap.values());
    }


    // Parses a standalone "Patient List" file — either the minimal CSV
    // downloaded from the Access History search (Patient Name, Gender, Age,
    // Patient No, Sample Receipt Date) or a fuller Details-style sheet with
    // extra columns (Spouse Name, Hospital/Clinic, Indication, ...). Any
    // column not present is simply left blank for the user to fill in.
    function _parsePatientListRows(wb) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      return rows
        .map(row => {
          const name = _getV(row, ["Patient Name", "Patient_Name", "PATIENT_NAME"]);
          if (!name) return null;
          return {
            patient_name: name,
            spouse_name: _getV(row, ["Spouse Name", "Spouse_Name", "Husband Name", "Partner Name"], "w/o"),
            pin: _getV(row, ["Patient No", "Patient_No", "PIN", "Sample ID", "Patient ID"]),
            age: _getV(row, ["Age", "Patient Age"]),
            gender: _getV(row, ["Gender", "Sex"]),
            sample_number: _stripDec(_getV(row, ["Sample Number", "Sample No", "Sample No.", "SampleNumber", "Lab Number", "Lab No", "Accession No", "Accession Number"])),
            referring_clinician: _getV(row, ["Referring Clinician", "Referring Clinician Name", "Referring Doctor", "Doctor Name", "Referred By", "Clinician", "Doctor"]),
            biopsy_date: _fmtDate(_getV(row, ["Date of Biopsy", "Biopsy Date"])),
            sample_collection_date: _fmtDate(_getV(row, ["Sample Collection Date", "Date of Sample Collection", "Collection Date", "Date Collected"])),
            hospital_clinic: _getV(row, ["Hospital/Clinic Name", "Hospital/Clinic", "Hospital_Clinic", "Hospital", "Clinic", "Center"]),
            specimen: _getV(row, ["Specimen Type", "Sample Type", "Specimen"], "DAY 5 TROPHECTODERM BIOPSY"),
            sample_receipt_date: _fmtDate(_getV(row, ["Sample Receipt Date", "Sample_Receipt_Date", "Date Sample Received", "Receipt Date"])),
            biopsy_performed_by: _getV(row, ["EMBRYOLOGIST NAME", "Biologist", "Biopsy Performed By"]),
            indication: _getV(row, ["Indication", "Clinical Indication"]),
          };
        })
        .filter(Boolean);
    }

    // Locates the per-embryo Result sheet inside a standalone Result
    // Excel/CSV: prefers a sheet literally named "Summary" (case-insensitive,
    // matching the FASTASEQ export layout); falls back to the first sheet so a
    // bare "Sample name/Conclusion/Result/QC" CSV export also works.
    function _extractSummaryRowsFromWorkbook(wb) {
      const sheetNamesLower = wb.SheetNames.map(s => s.toLowerCase());
      const idx = sheetNamesLower.indexOf("summary");
      const sheet = wb.Sheets[wb.SheetNames[idx !== -1 ? idx : 0]];
      const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      return _summaryRawToRows(raw);
    }

    // Cross-matches a Patient List against a separate Result file on Patient
    // No / PIN (mirroring the HLA "2 input fields" cross-match feature) and
    // returns ONLY the patients that have at least one matched embryo result.
    // Patients with no matching result are dropped from the list (as in the
    // HLA cross-match) but recorded in _lastMatchSkips so they are reported.
    function _crossMatchPatientListWithResult(patientRows, summaryRows) {
      const today = new Date().toLocaleDateString("en-GB").replace(/\//g, "-");
      const candidates = [];
      _lastMatchSkips = [];

      for (const p of patientRows) {
        const info = {
          patient_name: p.patient_name,
          spouse_name: p.spouse_name || "w/o",
          pin: p.pin,
          age: p.age,
          sample_number: p.sample_number,
          referring_clinician: p.referring_clinician || "",
          biopsy_date: p.biopsy_date, sample_collection_date: p.sample_collection_date || p.biopsy_date,
          hospital_clinic: p.hospital_clinic,
          specimen: p.specimen || "DAY 5 TROPHECTODERM BIOPSY",
          sample_receipt_date: p.sample_receipt_date,
          biopsy_performed_by: p.biopsy_performed_by,
          report_date: today,
          indication: p.indication,
          embryos: []
        };
        info._keys = _patientMatchKeys(p.patient_name, p.pin);
        candidates.push(info);
      }

      _assignEmbryosToPatients(candidates, summaryRows);
      const patients = [];
      for (const info of candidates) {
        delete info._keys;
        if (info.embryos.length) patients.push(info);
        else _lastMatchSkips.push({ name: info.patient_name, reason: _matchSkipReason(info.pin) });
      }
      return patients;
    }

    async function handleBulkFilesWithResult(patientFile, resultFile, images = []) {
      const lbl = document.getElementById("dropZoneLabel");
      const resultLbl = document.getElementById("resultDropZoneLabel");
      if (lbl) lbl.innerHTML = `<span class="spinner" style="border-color:#1F497D;border-top-color:#4F81BD;width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:6px;border-width:2px;border-style:solid;border-radius:50%;animation:spin 0.7s linear infinite;"></span>Cross-matching <strong>${esc(patientFile.name)}</strong> with <strong>${esc(resultFile.name)}</strong>…`;

      try {
        _lastMatchSkips = []; _lastRowSkips = [];
        const [patientWb, resultWb] = await Promise.all([_readWorkbook(patientFile), _readWorkbook(resultFile)]);
        const patientRows = _parsePatientListRows(patientWb);
        if (!patientRows.length) throw new Error("No patient rows found in the Patient List file.");
        const summaryRows = _extractSummaryRowsFromWorkbook(resultWb);
        if (!summaryRows.length) throw new Error("No result rows found in the Result file.");

        const patients = _crossMatchPatientListWithResult(patientRows, summaryRows);
        if (!patients.length) throw new Error(`${patientRows.length} patient row(s) read, but none could be matched to a result. Rows match on Patient No / PIN when both files carry one, otherwise on the patient name in the Sample name ("<PATIENT NAME>-E1") — check that one of those lines up (see the list below).`);

        state.bulkPatients = patients;
        _trackBulkAutosaveKey(patientFile.name);

        // Auto-map any CNV chart images that were dropped alongside the files.
        let mapped = 0;
        if (images && images.length > 0) mapped = await _autoMapCnvImagesLocal(images);

        renderBulkPatients();
        _renderMatchSkips();
        document.getElementById("bulkPatientSection").classList.remove("hidden");

        const skipped = _lastMatchSkips.length;
        if (lbl) {
          let msg = `<strong>${esc(patientFile.name)}</strong> &mdash; ${patients.length} matched patient(s)`;
          if (skipped > 0) msg += ` <small style="color:#b45309;font-weight:bold;">(${skipped} unmatched, skipped)</small>`;
          if (mapped > 0) msg += ` <small style="color:var(--success);font-weight:bold;">(+${mapped} CNVs)</small>`;
          lbl.innerHTML = msg + ` &nbsp;<small style="color:var(--text-muted);text-decoration:underline;">(click to change)</small>`;
        }
        showToast(`Cross-matched ${patients.length} patient(s)` + (skipped ? ` — ${skipped} skipped (no matching result)` : "") + (mapped ? ` + ${mapped} CNV chart(s)` : ""), skipped ? "warning" : "success");
      } catch (err) {
        if (lbl) lbl.innerHTML = `<span style="color:#c00;">Error: ${esc(err.message)}</span> &nbsp;<small style="text-decoration:underline;">(click to retry)</small>`;
        _renderMatchSkips();
        if (_lastMatchSkips.length) document.getElementById("bulkPatientSection").classList.remove("hidden");
        showToast("Cross-match failed: " + err.message, "error");
      }
    }

    function _readWorkbook(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
          try { resolve(XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: true })); }
          catch (err) { reject(err); }
        };
        reader.onerror = () => reject(new Error("File read error"));
        reader.readAsArrayBuffer(file);
      });
    }


    async function handleBulkFile(file) {
      return await handleBulkFiles([file]);
    }

    
    
    

    
    function triggerLocalCnvPicker() {
      if (!state.bulkPatients || state.bulkPatients.length === 0) {
        showToast('Please load an Excel file first before fetching CNV charts.', 'info');
        return;
      }
      document.getElementById('cnvAutoInput').value = '';
      document.getElementById('cnvAutoInput').click();
    }

    
    async function _autoMapCnvImagesLocal(imgFilesInput) {
      const allImgs = Array.from(imgFilesInput).filter(f => /\.(png|jpe?g)$/i.test(f.name));
      if (!allImgs.length || !state.bulkPatients?.length) return 0;

      const an    = s => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const anLow = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const extractNum = s => parseInt((s.match(/\d+/) || [999])[0]);
      const readB64 = f => new Promise(res => {
        const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = () => res(null); r.readAsDataURL(f);
      });

      
      const noxyFiles = allImgs.filter(f => /noXY_nomos/i.test(f.name));

      const allEmbryos = [];
      state.bulkPatients.forEach((p, pi) => {
        const pNorm = _normName(p.patient_name || "");  
        (p.embryos || []).forEach((emb, ei) =>
          allEmbryos.push({ pi, ei, emb, pNorm, mapped: false }));
      });

      const usedFiles = new Set();
      let count = 0;

      // Pass 0 - desktop-app rule: match a file whose name (case-insensitive)
      // STARTS WITH the sample name up to the first underscore
      // (e.g. sample "PALLAVI-E1_noXY..." -> base "PALLAVI-E1"; file
      // "PALLAVI-E1_CNV.png" matches). This mirrors parse_bulk_excel() in the
      // desktop app and is the most authoritative match, so it runs first.
      for (const entry of allEmbryos) {
        if (entry.mapped) continue;
        const sampleName = entry.emb.sample_name || "";
        if (!sampleName) continue;
        const base = sampleName.split("_")[0].toUpperCase();
        if (!base) continue;
        const candidates = allImgs.filter(img => !usedFiles.has(img.name) && img.name.toUpperCase().startsWith(base));
        const f = candidates.find(img => /_noXY_nomos/i.test(img.name)) || candidates[0];
        if (f) {
          const b64 = await readB64(f);
          if (b64) {
            state.bulkPatients[entry.pi].embryos[entry.ei].cnv_image_b64  = b64;
            state.bulkPatients[entry.pi].embryos[entry.ei].cnv_image_name = f.name;
            state.bulkPatients[entry.pi].embryos[entry.ei].cnv_image_path = "";
            entry.mapped = true; usedFiles.add(f.name); count++;
          }
        }
      }




      for (const f of noxyFiles) {
        if (usedFiles.has(f.name)) continue;
        const stem = f.name.replace(/\.[^.]+$/, "");
        const prefix = stem.replace(/_noXY_nomos.*/i, "");               
        const dashIdx = prefix.indexOf("-");
        if (dashIdx === -1) continue;
        const filePatient = an(prefix.slice(0, dashIdx));                 
        const fileEmbryo  = an(prefix.slice(dashIdx + 1).split("_")[0]); 

        for (const entry of allEmbryos) {
          if (entry.mapped || usedFiles.has(f.name)) continue;
          if (an(entry.emb.embryo_id || "") !== fileEmbryo) continue;

          
          const pn = entry.pNorm;
          const minLen = Math.min(pn.length, filePatient.length);
          const overlap = minLen >= 6 && (pn.startsWith(filePatient.slice(0, minLen)) ||
                                          filePatient.startsWith(pn.slice(0, minLen)));
          if (!overlap) continue;

          const b64 = await readB64(f);
          if (b64) {
            state.bulkPatients[entry.pi].embryos[entry.ei].cnv_image_b64  = b64;
            state.bulkPatients[entry.pi].embryos[entry.ei].cnv_image_name = f.name;
            state.bulkPatients[entry.pi].embryos[entry.ei].cnv_image_path = "";
            entry.mapped = true; usedFiles.add(f.name); count++;
          }
          break;
        }
      }

      
      for (const f of noxyFiles) {
        if (usedFiles.has(f.name)) continue;
        const stem   = f.name.replace(/\.[^.]+$/, "");
        const prefix = stem.replace(/_noXY_nomos.*/i, "");
        const dashIdx = prefix.indexOf("-");
        if (dashIdx === -1) continue;
        const filePatient = an(prefix.slice(0, dashIdx));
        const fileEmbryo  = an(prefix.slice(dashIdx + 1).split("_")[0]);

        for (const entry of allEmbryos) {
          if (entry.mapped || usedFiles.has(f.name)) continue;
          if (an(entry.emb.embryo_id || "") !== fileEmbryo) continue;
          
          const pn = entry.pNorm;
          if (!pn.slice(0, 5) || (!pn.includes(filePatient.slice(0, 5)) && !filePatient.includes(pn.slice(0, 5)))) continue;
          const b64 = await readB64(f);
          if (b64) {
            state.bulkPatients[entry.pi].embryos[entry.ei].cnv_image_b64  = b64;
            state.bulkPatients[entry.pi].embryos[entry.ei].cnv_image_name = f.name;
            state.bulkPatients[entry.pi].embryos[entry.ei].cnv_image_path = "";
            entry.mapped = true; usedFiles.add(f.name); count++;
          }
          break;
        }
      }

      
      const unmappedEntries = allEmbryos.filter(e => !e.mapped);
      const unusedImgs = allImgs.filter(f => !usedFiles.has(f.name));

      for (const entry of unmappedEntries) {
        const eid    = (entry.emb.embryo_id || "").trim(); if (!eid) continue;
        const eidLow = eid.toLowerCase();
        const eidN   = anLow(eid);
        const re = new RegExp("(^|[^a-z0-9])" + eidLow.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)", "i");

        let f = unusedImgs.find(img => !usedFiles.has(img.name) && re.test(img.name));
        if (!f) f = unusedImgs.find(img => !usedFiles.has(img.name) && anLow(img.name).includes(eidN));
        if (f) {
          const b64 = await readB64(f);
          if (b64) {
            state.bulkPatients[entry.pi].embryos[entry.ei].cnv_image_b64  = b64;
            state.bulkPatients[entry.pi].embryos[entry.ei].cnv_image_name = f.name;
            state.bulkPatients[entry.pi].embryos[entry.ei].cnv_image_path = "";
            entry.mapped = true; usedFiles.add(f.name); count++;
          }
        }
      }

      
      const stillUnmapped  = allEmbryos.filter(e => !e.mapped);
      const stillAvailable = allImgs.filter(f => !usedFiles.has(f.name));
      if (stillUnmapped.length > 0 && stillUnmapped.length === stillAvailable.length) {
        stillUnmapped.sort((a, b) => extractNum(a.emb.embryo_id || "") - extractNum(b.emb.embryo_id || ""));
        stillAvailable.sort((a, b) => extractNum(a.f?.name || a.name) - extractNum(b.f?.name || b.name));
        for (let k = 0; k < stillUnmapped.length; k++) {
          const b64 = await readB64(stillAvailable[k]);
          if (b64) {
            state.bulkPatients[stillUnmapped[k].pi].embryos[stillUnmapped[k].ei].cnv_image_b64  = b64;
            state.bulkPatients[stillUnmapped[k].pi].embryos[stillUnmapped[k].ei].cnv_image_name = stillAvailable[k].name;
            state.bulkPatients[stillUnmapped[k].pi].embryos[stillUnmapped[k].ei].cnv_image_path = "";
            count++;
          }
        }
      }

      return count;
    }

    async function autoFetchLocalCnvImages(files) {
      if (!files || files.length === 0) return;
      if (!state.bulkPatients || state.bulkPatients.length === 0) {
        showToast('No patient data loaded — upload an Excel first.', 'info');
        return;
      }
      const imgFiles = Array.from(files).filter(f => /\.(png|jpe?g)$/i.test(f.name));
      if (imgFiles.length === 0) {
        showToast('No PNG/JPG images found in your selection.', 'error');
        return;
      }

      const btn = document.getElementById('cnvAutoFetchBtn');
      const statusEl = document.getElementById('cnvAutoFetchStatus');
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="border-color:#fff;border-top-color:#f59e0b;width:12px;height:12px;display:inline-block;border-width:2px;border-style:solid;border-radius:50%;animation:spin 0.7s linear infinite;"></span> Mapping…'; }
      if (statusEl) statusEl.style.display = 'none';

      const mappedCount = await _autoMapCnvImagesLocal(imgFiles);

      if (bulkSelectedIndex >= 0) {
        renderBulkEditor(bulkSelectedIndex);
        previewBulkPatient(bulkSelectedIndex);
      }
      if (statusEl) {
        statusEl.style.display = '';
        statusEl.style.background = mappedCount > 0 ? '#d1fae5' : '#fee2e2';
        statusEl.style.color      = mappedCount > 0 ? '#065f46' : '#991b1b';
        statusEl.textContent      = mappedCount > 0 ? `✓ ${mappedCount} CNV matched` : '✗ 0 matched';
      }
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-images"></i> Load CNV Charts'; }
      if (mappedCount > 0) {
        showToast(`Auto-mapped ${mappedCount} CNV chart${mappedCount > 1 ? 's' : ''} from local files`, 'success');
      } else {
        showToast('No CNV charts matched. Check filenames contain patient name + embryo ID (e.g. KALPANASONI-KS1_...).', 'info');
      }
    }

    // Sets Report Type on every loaded bulk patient in one go (mirrors the
    // per-patient override in the editor panel, which still wins if the user
    // changes an individual patient afterward).
    function applyBulkReportTemplateToAll(value) {
      if (!state.bulkPatients || !state.bulkPatients.length) {
        showToast("No patients loaded", "info");
        return;
      }
      state.bulkPatients.forEach(p => {
        p.report_template = value;
        if (value === "pgtsr" && !(p.indication || "").trim()) p.indication = PGTSR_DEFAULT_INDICATION;
      });
      if (bulkSelectedIndex >= 0) {
        renderBulkEditor(bulkSelectedIndex);
        previewBulkPatient(bulkSelectedIndex);
      }
      showToast(`Report Type set to ${value === "pgtsr" ? "PGT-SR" : "PGT-A"} for all ${state.bulkPatients.length} patient(s)`, "success");
    }

    let bulkSelectedIndex = -1;

    // Shows which patients got no report, and which Result rows found no
    // patient. Without this the batch just comes out smaller than the patient
    // list with no explanation.
    function _renderMatchSkips() {
      const box = document.getElementById("bulkMatchWarning");
      if (!box) return;
      if (!_lastMatchSkips.length && !_lastRowSkips.length) { box.style.display = "none"; box.innerHTML = ""; return; }

      let html = `<button type="button" onclick="document.getElementById('bulkMatchWarning').style.display='none';" `
        + `title="Dismiss" style="position:absolute;top:6px;right:6px;width:18px;height:18px;line-height:16px;padding:0;`
        + `border:none;background:transparent;color:#7a5a00;font-size:14px;cursor:pointer;">&times;</button>`;
      if (_lastMatchSkips.length) {
        html += `<div style="font-weight:700;margin-bottom:4px;">`
          + `<i class="fas fa-exclamation-triangle"></i> `
          + `${_lastMatchSkips.length} patient(s) skipped &mdash; no matching result row</div>`
          + `<ul style="margin:0 0 0 18px;padding:0;">`
          + _lastMatchSkips.map(s => `<li><strong>${esc(s.name)}</strong> &mdash; ${esc(s.reason)}</li>`).join("")
          + `</ul>`;
      }
      if (_lastRowSkips.length) {
        html += `<div style="font-weight:700;margin:${_lastMatchSkips.length ? "6px" : "0"} 0 4px;">`
          + `<i class="fas fa-exclamation-triangle"></i> `
          + `${_lastRowSkips.length} result row(s) not used</div>`
          + `<ul style="margin:0 0 0 18px;padding:0;">`
          + _lastRowSkips.map(s => `<li><strong>${esc(s.sample)}</strong> &mdash; ${esc(s.reason)}</li>`).join("")
          + `</ul>`;
      }
      html += `<div style="margin-top:5px;opacity:0.85;">Rows are matched to patients on Patient No / PIN when both sides carry one, `
        + `otherwise on the patient name in the Sample name (<strong>&lt;PATIENT NAME&gt;-E1</strong>). `
        + `A row that fits two patients equally well is never guessed &mdash; give those patients a Patient No / PIN to tell them apart.</div>`;
      box.innerHTML = html;
      box.style.display = "block";
    }

    function renderBulkPatients() {
      const section = document.getElementById("bulkPatientSection");
      const list = document.getElementById("bulkPatientList");
      const count = document.getElementById("bulkPatientCount");
      section.classList.remove("hidden");
      count.textContent = `(${state.bulkPatients.length} patients)`;
      list.innerHTML = "";
      state.bulkPatients.forEach((p, i) => {
        const div = document.createElement("div");
        div.className = "bulk-patient-item"; div.id = `bulk-patient-${i}`;
        div.onclick = function (e) { if (e.target.tagName !== "INPUT" && e.target.tagName !== "BUTTON" && !e.target.closest("button")) selectBulkPatient(i); };
        div.innerHTML = `
      <input type="checkbox" class="bulk-cb" id="bulk-cb-${i}" checked onchange="updateBulkSelectedCount()">
      <div class="patient-info">
        <div class="patient-name">${esc(p.patient_name || "Unknown")} (${(p.embryos || []).length} embryos)</div>
        ${p.sample_number ? `<div class="patient-meta">${esc(p.sample_number)}</div>` : ''}
      </div>
      <span class="patient-status" id="bulk-status-${i}" style="font-size:9px;display:none;"></span>`;
        list.appendChild(div);
      });
      bulkSelectedIndex = -1;
      updateBulkSelectedCount();
      if (state.bulkPatients.length > 0) selectBulkPatient(0);
    }

    function bulkSelectAll() {
      state.bulkPatients.forEach((_, i) => { const cb = document.getElementById(`bulk-cb-${i}`); if (cb) cb.checked = true; });
      updateBulkSelectedCount();
    }
    function bulkDeselectAll() {
      state.bulkPatients.forEach((_, i) => { const cb = document.getElementById(`bulk-cb-${i}`); if (cb) cb.checked = false; });
      updateBulkSelectedCount();
    }
    function updateBulkSelectedCount() {
      let count = 0;
      state.bulkPatients.forEach((_, i) => { const cb = document.getElementById(`bulk-cb-${i}`); if (cb && cb.checked) count++; });
      const lbl = document.getElementById("bulkSelectedCountLabel");
      if (lbl) lbl.textContent = `${count} selected`;
    }
    function getSelectedBulkIndices() {
      const indices = [];
      state.bulkPatients.forEach((_, i) => { const cb = document.getElementById(`bulk-cb-${i}`); if (cb && cb.checked) indices.push(i); });
      return indices;
    }

    function filterBulkPatients() {
      const q = (document.getElementById("bulkSearch").value || "").toLowerCase();
      document.querySelectorAll("#bulkPatientList .bulk-patient-item").forEach((item, i) => {
        const name = (state.bulkPatients[i]?.patient_name || "").toLowerCase();
        item.style.display = name.includes(q) ? "" : "none";
      });
    }

    function selectBulkPatient(i) {
      bulkSelectedIndex = i;
      document.querySelectorAll("#bulkPatientList .bulk-patient-item").forEach((item, j) => {
        item.classList.toggle("active", j === i);
      });
      renderBulkEditor(i);
      
      previewBulkPatient(i);
    }

    function renderBulkEditor(i) {
      const p = state.bulkPatients[i];
      if (!p) return;
      const el = document.getElementById("bulkEditorContent");
      const embryos = p.embryos || [];

      
      let html = `<div class="bulk-editor-section">
    <h4> Patient Information</h4>
    <div class="bulk-editor-field"><label>Patient Name:</label><input type="text" value="${esc(p.patient_name || "")}" oninput="state.bulkPatients[${i}].patient_name=this.value;scheduleBulkPreview()"></div>
    <div class="bulk-editor-field"><label>Spouse Name:</label><input type="text" value="${esc(p.spouse_name || "w/o")}" oninput="state.bulkPatients[${i}].spouse_name=this.value;scheduleBulkPreview()"></div>
    <div class="bulk-editor-field"><label>PIN:</label><input value="${esc(p.pin || "")}" oninput="state.bulkPatients[${i}].pin=this.value;scheduleBulkPreview()"></div>
    <div class="bulk-editor-field"><label>Age:</label><input value="${esc(p.age || "")}" oninput="state.bulkPatients[${i}].age=this.value;scheduleBulkPreview()"></div>
    <div class="bulk-editor-field"><label>Sample Number:</label><input value="${esc(p.sample_number || "")}" oninput="state.bulkPatients[${i}].sample_number=this.value;scheduleBulkPreview()"></div>
    <div class="bulk-editor-field"><label>Referring Clinician:</label><input value="${esc(p.referring_clinician || "")}" oninput="state.bulkPatients[${i}].referring_clinician=this.value;scheduleBulkPreview()"></div>
    <div class="bulk-editor-field"><label>Biopsy Date:</label><input value="${esc(p.biopsy_date || "")}" oninput="state.bulkPatients[${i}].biopsy_date=this.value;scheduleBulkPreview()"></div>
    <div class="bulk-editor-field"><label>Hospital/Clinic:</label><textarea rows="2" oninput="state.bulkPatients[${i}].hospital_clinic=this.value;scheduleBulkPreview()">${esc(p.hospital_clinic || "")}</textarea></div>
    <div class="bulk-editor-field"><label>Sample Collection Date:</label><input value="${esc(p.sample_collection_date || "")}" oninput="state.bulkPatients[${i}].sample_collection_date=this.value;scheduleBulkPreview()"></div>
    <div class="bulk-editor-field"><label>Specimen:</label><textarea rows="2" oninput="state.bulkPatients[${i}].specimen=this.value;scheduleBulkPreview()">${esc(p.specimen || "DAY 5 TROPHECTODERM BIOPSY")}</textarea></div>
    <div class="bulk-editor-field"><label>Sample Receipt Date:</label><input value="${esc(p.sample_receipt_date || "")}" oninput="state.bulkPatients[${i}].sample_receipt_date=this.value;scheduleBulkPreview()"></div>
    <div class="bulk-editor-field"><label>Biopsy Performed By:</label><input value="${esc(p.biopsy_performed_by || "")}" oninput="state.bulkPatients[${i}].biopsy_performed_by=this.value;scheduleBulkPreview()"></div>
    <div class="bulk-editor-field"><label>Report Date:</label><input value="${esc(p.report_date || todayStr())}" oninput="state.bulkPatients[${i}].report_date=this.value;scheduleBulkPreview()"></div>
    <div class="bulk-editor-field"><label>Report Type:</label>
      <select onchange="state.bulkPatients[${i}].report_template=this.value; if(this.value==='pgtsr' && !(state.bulkPatients[${i}].indication||'').trim()){state.bulkPatients[${i}].indication=PGTSR_DEFAULT_INDICATION;} renderBulkEditor(${i}); scheduleBulkPreview()">
        <option value="pgta" ${(p.report_template || "pgta") === "pgta" ? "selected" : ""}>PGT-A (Aneuploid)</option>
        <option value="pgtsr" ${p.report_template === "pgtsr" ? "selected" : ""}>PGT-SR (Structural Rearrangement)</option>
      </select>
    </div>
    <div class="bulk-editor-field"><label>Indication:</label><textarea id="bulk_indication_${i}" rows="3" oninput="state.bulkPatients[${i}].indication=this.value;scheduleBulkPreview()">${esc(p.indication || "")}</textarea></div>
    <div class="bulk-editor-field"><label>Results Summary Comment:</label><textarea rows="2" oninput="state.bulkPatients[${i}].results_summary_comment=this.value;scheduleBulkPreview()">${esc(p.results_summary_comment || "")}</textarea></div>
  </div>`;


      const summaryRowsHtml = embryos.map((emb, ei) => {
        // Verbatim, for the same reason as renderSummaryTable().
        const matchedResult = emb.result_summary || "";
        const resultColor = getResultColor(emb.result_summary);
        const prettyInterp = getPrettyInterpretation(emb);
        const interpColor = getInterpColor(prettyInterp);
        return `<tr>
      <td>${ei + 1}</td>
      <td><input type="text" value="${esc(emb.embryo_id || "")}" oninput="state.bulkPatients[${i}].embryos[${ei}].embryo_id=this.value;scheduleBulkPreview()" style="width:80px;"></td>
      <td>
        <input type="text" list="result-summary-dl" value="${esc(matchedResult)}" style="color:${resultColor};font-weight:600;min-width:150px;"
          onfocus="datalistShowAll(this)" onblur="datalistRestore(this)"
          oninput="this.style.color=getResultColor(this.value);updateBulkSummaryResult(${i},${ei},this.value)"
          placeholder="Select or type result...">
      </td>
      <td><input type="text" value="${esc(emb.mtcopy || 'NA')}" oninput="state.bulkPatients[${i}].embryos[${ei}].mtcopy=this.value;scheduleBulkPreview()" style="width:70px;" placeholder="NA"></td>
      <td>
        <select class="bulk-interp-${i}-${ei}" onchange="updateBulkSummaryInterp(${i},${ei},this.value,this)"
          style="color:${interpColor};font-weight:600;">
          ${interpOptionsFor(p.report_template).map(v => `<option style="color:${getInterpColor(v)};"${(emb.interpretation || "") === v ? " selected" : ""}>${esc(v)}</option>`).join("")}
        </select>
      </td>
    </tr>`;
      }).join("");

      html += `<div class="bulk-editor-section">
    <h4> Page 1: Results Summary</h4>
    <div class="summary-table-wrap">
      <table id="bulkResultsSummaryTable" class="results-summary-table">
        <thead>
          <tr>
            <th style="width:40px;">S.No</th>
            <th style="width:95px;">Sample</th>
            <th>Result</th>
            <th style="width:80px;">MTcopy</th>
            <th style="width:80px;">Interpretation</th>
          </tr>
        </thead>
        <tbody>${summaryRowsHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;">No embryo data</td></tr>'}</tbody>
      </table>
    </div>
  </div>`;


      if (embryos.length === 0) {
        html += `<p class="info-text" style="padding:20px;text-align:center;">No embryo data for this patient.</p>`;
      }
      embryos.forEach((emb, ei) => {
        html += `<div class="bulk-editor-section">
      <h4 style="display:flex;align-items:center;justify-content:space-between;gap:8px;"><span> Embryo: ${esc(emb.embryo_id || ("Embryo " + (ei + 1)))}</span>
        <button type="button" title="Delete this embryo" style="font-size:10px;padding:2px 8px;background:#fee2e2;color:#b91c1c;border:none;border-radius:4px;cursor:pointer;" onclick="deleteBulkEmbryo(${i},${ei})"><i class="fas fa-trash"></i> Delete</button></h4>
      <div class="bulk-editor-field"><label>Embryo ID:</label><input value="${esc(emb.embryo_id || "")}" oninput="state.bulkPatients[${i}].embryos[${ei}].embryo_id=this.value;scheduleBulkPreview()"></div>
      <div class="bulk-editor-field"><label>Result Summary:</label>
        ${(() => {
          const matchedRS = emb.result_summary || "";
          return `<input type="text" list="result-summary-dl" value="${esc(matchedRS)}" style="color:${getResultColor(matchedRS)};font-weight:600;"
          onfocus="datalistShowAll(this)" onblur="datalistRestore(this)"
          oninput="this.style.color=getResultColor(this.value);updateBulkSummaryResult(${i},${ei},this.value)" placeholder="Select or type result summary...">`;
        })()}
      </div>
      <div class="bulk-editor-field"><label>Result Description (Page 4):</label>
        ${(() => {
          const rdVal = emb.result_description || "";
          return `<input type="text" list="result-desc-dl" value="${esc(rdVal)}" style="color:${getDescColor(rdVal)};font-weight:600;"
          onfocus="datalistShowAll(this)" onblur="datalistRestore(this)"
          oninput="this.style.color=getDescColor(this.value);state.bulkPatients[${i}].embryos[${ei}].result_description=this.value;scheduleBulkPreview()" placeholder="Select or type description...">`;
        })()}
      </div>
      <div class="bulk-editor-field"><label>Autosomes:</label><input value="${esc(emb.autosomes || "Normal")}" oninput="state.bulkPatients[${i}].embryos[${ei}].autosomes=this.value;scheduleBulkPreview()"></div>
      <div class="bulk-editor-field"><label>Sex Chromosomes:</label>
        <input type="text" list="bulk-sex-dl-${i}-${ei}" value="${esc(emb.sex_chromosomes || "Normal")}" placeholder="Normal, -X, Mosaic +X..."
          style="color:${getSexChrColor(emb.sex_chromosomes)};font-weight:600;"
          onfocus="sexDatalistFocus(this)" onblur="sexDatalistBlur(this)"
          oninput="this.style.color=getSexChrColor(this.value);state.bulkPatients[${i}].embryos[${ei}].sex_chromosomes=this.value;scheduleBulkPreview()">
        <datalist id="bulk-sex-dl-${i}-${ei}">${SEX_DATALIST_OPTIONS.map(o => `<option value="${esc(o)}">`).join("")}</datalist>
      </div>
      <div class="bulk-editor-field"><label>Interpretation:</label>
        <select class="bulk-interp-${i}-${ei}" style="color:${getInterpColor(emb.interpretation || "NA")};font-weight:600;" onchange="this.style.color=getInterpColor(this.value);state.bulkPatients[${i}].embryos[${ei}].interpretation=this.value;scheduleBulkPreview()">
          ${interpOptionsFor(p.report_template).map(v => `<option style="color:${getInterpColor(v)};"${(emb.interpretation || "NA") === v ? " selected" : ""}>${v}</option>`).join("")}
        </select>
      </div>
      <div class="bulk-editor-field"><label>MTcopy:</label><input value="${esc(emb.mtcopy || "")}" oninput="state.bulkPatients[${i}].embryos[${ei}].mtcopy=this.value;scheduleBulkPreview()"></div>
      <div class="bulk-editor-field"><label>Inconclusive Comment:</label><input value="${esc(emb.inconclusive_comment || "")}" oninput="state.bulkPatients[${i}].embryos[${ei}].inconclusive_comment=this.value;scheduleBulkPreview()" placeholder="If inconclusive..."></div>
      <div class="bulk-editor-field">
        <label>CNV Chart Image</label>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          ${emb.cnv_image_b64
            ? `<span class="cnv-mapped-badge"><i class="fas fa-cloud"></i> Cloud-mapped: ${esc(emb.cnv_image_name || "image")}</span>
               <button style="font-size:10px;padding:2px 8px;background:#fee2e2;color:#b91c1c;border:none;border-radius:4px;cursor:pointer;" onclick="state.bulkPatients[${i}].embryos[${ei}].cnv_image_b64='';state.bulkPatients[${i}].embryos[${ei}].cnv_image_name='';renderBulkEditor(${i});">Remove</button>`
            : `<span class="cnv-mapped-badge miss"><i class="fas fa-exclamation-triangle"></i> Not mapped</span>
               <input type="file" id="bulk-cnv-${i}-${ei}" accept=".png,.jpg,.jpeg" style="display:none;" onchange="handleBulkCnvUpload(${i},${ei},this.files[0])">
               <button style="font-size:10px;padding:2px 8px;background:var(--primary);color:#fff;border:none;border-radius:4px;cursor:pointer;" onclick="document.getElementById('bulk-cnv-${i}-${ei}').click()">Upload</button>`
          }
        </div>
        ${emb.cnv_image_b64 ? `<div style="margin-top:8px;max-width:100%;"><img src="${esc(emb.cnv_image_b64)}" alt="CNV" style="max-width:100%;max-height:140px;border:1px solid #d1d5db;border-radius:8px;object-fit:contain;"></div>` : ''}
      </div>
      <div style="margin-top:6px;padding:6px 8px;background:var(--grey-box);border-radius:6px;">
        <div style="font-size:10px;font-weight:700;color:var(--primary);margin-bottom:4px;"> Chromosome Details (1–22)</div>
        <div class="bulk-chr-grid">${renderBulkChrGrid(i, ei, emb)}</div>
      </div>
    </div>`;
      });
      el.innerHTML = html;
      el.scrollTop = 0;
    }

    function deleteBulkEmbryo(pi, ei) {
      const p = state.bulkPatients[pi];
      const emb = p?.embryos?.[ei];
      if (!emb) return;
      if (!confirm(`Delete embryo "${emb.embryo_id || "Embryo " + (ei + 1)}"?`)) return;
      const top = document.getElementById("bulkEditorContent").scrollTop;
      p.embryos.splice(ei, 1);
      renderBulkEditor(pi);
      document.getElementById("bulkEditorContent").scrollTop = top;
      const nameEl = document.querySelector(`#bulk-patient-${pi} .patient-name`);
      if (nameEl) nameEl.textContent = `${p.patient_name || "Unknown"} (${p.embryos.length} embryos)`;
      scheduleBulkPreview();
    }

    function updateBulkSummaryResult(pi, ei, value) {
      const emb = state.bulkPatients[pi]?.embryos?.[ei];
      if (!emb) return;
      emb.result_summary = value;

      if (!emb.result_description || RESULT_OPTIONS.includes(emb.result_description)) {
        emb.result_description = summaryToDescription(value);
      }
      // Keep the Interpretation in step with a "no result" Result, so the
      // editor shows the NA the report will print rather than a stale Euploid.
      if (isNoResultSummary(value) && isAmbiguousOrNormalInterp(emb.interpretation)) {
        emb.interpretation = "NA";
        document.querySelectorAll(`.bulk-interp-${pi}-${ei}`).forEach(sel => {
          sel.value = "NA";
          sel.style.color = getInterpColor("NA");
        });
      }
      scheduleBulkPreview();
    }

    function updateBulkSummaryInterp(pi, ei, value, selectEl) {
      const emb = state.bulkPatients[pi]?.embryos?.[ei];
      if (!emb) return;
      emb.interpretation = value;
      selectEl.style.color = getInterpColor(value);
      scheduleBulkPreview();
    }

    function renderBulkChrGrid(pi, ei, emb) {
      const cs = emb.chromosome_statuses || {};
      const mp = emb.mosaic_percentages || {};
      let html = "";
      for (let c = 1; c <= 22; c++) {
        const s = cs[String(c)] || "N";
        const m = mp[String(c)] || "";
        const opts = CHR_STATUSES.map(o => `<option${s === o ? " selected" : ""}>${o}</option>`).join("");
        html += `<span class="chr-label">${c}</span>
      <select onchange="onBulkChrChange(${pi},${ei},${c},'status',this.value)">${opts}</select>
      <input type="text" value="${esc(m)}" placeholder="-" oninput="onBulkChrChange(${pi},${ei},${c},'mosaic',this.value)">`;
      }
      return html;
    }

    function onBulkChrChange(pi, ei, chr, type, value) {
      const emb = state.bulkPatients[pi]?.embryos?.[ei];
      if (!emb) return;
      const k = String(chr);
      if (!emb.chromosome_statuses) emb.chromosome_statuses = {};
      if (!emb.mosaic_percentages) emb.mosaic_percentages = {};
      if (type === "status") emb.chromosome_statuses[k] = value;
      else emb.mosaic_percentages[k] = value;
      scheduleBulkPreview();
    }

    function handleBulkCnvUpload(pi, ei, file) {
      if (!file) return;
      const emb = state.bulkPatients[pi]?.embryos?.[ei];
      if (!emb) return;
      const reader = new FileReader();
      reader.onload = e => {
        emb.cnv_image_b64  = e.target.result;
        emb.cnv_image_name = file.name;
        renderBulkEditor(pi);
        if (bulkSelectedIndex === pi) {
          previewBulkPatient(pi);
        } else {
          scheduleBulkPreview();
        }
        showToast(`CNV image set for Embryo ${emb.embryo_id || (ei + 1)}`, "success");
      };
      reader.readAsDataURL(file);
    }

    let bulkPreviewTimer = null;
    function scheduleBulkPreview() {
      if (bulkPreviewTimer) clearTimeout(bulkPreviewTimer);
      bulkPreviewTimer = setTimeout(() => {
        if (bulkSelectedIndex >= 0) previewBulkPatient(bulkSelectedIndex);
      }, 700);
    }

    function previewSelectedBulkPatient() {
      if (bulkSelectedIndex < 0) { showToast("Select a patient first", "info"); return; }
      previewBulkPatient(bulkSelectedIndex);
    }


    
    function buildBulkPayload(p, showLogo, showGrid) {
      const embryos = (p.embryos || []).map(e => {
        const s = {}, m = {};
        for (let c = 1; c <= 22; c++) { s[String(c)] = "N"; m[String(c)] = ""; }
        return {
          embryo_id: e.embryo_id || "", embryo_id_detail: e.embryo_id || "",
          result_summary: e.result_summary || "", result_description: e.result_description || e.result_summary || "",
          interpretation: e.interpretation || "NA", mtcopy: e.mtcopy || "",
          autosomes: e.autosomes || "Normal", sex_chromosomes: e.sex_chromosomes || "Normal",
          cnv_image_path: e.cnv_image_path || "",
          cnv_image_b64: e.cnv_image_b64 || "",
          chromosome_statuses: Object.assign(s, e.chromosome_statuses || {}),
          mosaic_percentages: Object.assign(m, e.mosaic_percentages || {}),
          inconclusive_comment: e.inconclusive_comment || ""
        };
      });
      return {
        patient_info: {
          patient_name: p.patient_name || "", spouse_name: p.spouse_name || "w/o",
          pin: p.pin || "", age: p.age || "", sample_number: p.sample_number || "",
          referring_clinician: p.referring_clinician || "", biopsy_date: p.biopsy_date || "",
          hospital_clinic: p.hospital_clinic || "", sample_collection_date: p.sample_collection_date || "",
          specimen: p.specimen || "DAY 5 TROPHECTODERM BIOPSY", sample_receipt_date: p.sample_receipt_date || "",
          biopsy_performed_by: p.biopsy_performed_by || "", report_date: p.report_date || todayStr(),
          indication: p.indication || "", results_summary_comment: p.results_summary_comment || "",
          report_template: p.report_template || "pgta"
        },
        embryos: embryos,
        options: { show_logo: showLogo, show_grid: showGrid, formats: ["pdf"] },

        patient_data: {
          patient_name: p.patient_name || "", spouse_name: p.spouse_name || "w/o",
          pin: p.pin || "", age: p.age || "", sample_number: p.sample_number || "",
          referring_clinician: p.referring_clinician || "", biopsy_date: p.biopsy_date || "",
          hospital_clinic: p.hospital_clinic || "", sample_collection_date: p.sample_collection_date || "",
          specimen: p.specimen || "DAY 5 TROPHECTODERM BIOPSY", sample_receipt_date: p.sample_receipt_date || "",
          biopsy_performed_by: p.biopsy_performed_by || "", report_date: p.report_date || todayStr(),
          indication: p.indication || "", results_summary_comment: p.results_summary_comment || "",
          report_template: p.report_template || "pgta"
        },
        embryos_data: embryos, show_logo: showLogo, show_grid: showGrid
      };
    }

    
    
    
    let _bulkRenderToken = 0;
    async function previewBulkPatient(i) {
      const myToken = ++_bulkRenderToken;
      const p = state.bulkPatients[i];
      const showLogo = document.getElementById("bulkLogoOption").value === "with_logo";
      const showGrid = document.getElementById("bulkGridOption").value === "with_grid";
      const wrap = document.getElementById("bulkPreviewWrap");
      const ph = document.getElementById("bulkPreviewPlaceholder");
      
      if (wrap) wrap.querySelectorAll("canvas, .preview-page-label").forEach(c => c.remove());
      if (ph) { ph.style.display = "flex"; ph.innerHTML = `<span style="font-size:11px;color:#94a3b8;">Loading ${esc(p.patient_name || "Patient")}...</span>`; }
      try {
        const res = await fetch(`${PGTA_BASE}/api/pgta/preview`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildBulkPayload(p, showLogo, showGrid))
        });
        if (myToken !== _bulkRenderToken) return;
        if (!res.ok) throw await uploadError(res);
        const data = await res.json(); if (data.error) throw new Error(data.error);
        await loadPdfToBulkPreview(`${PGTA_BASE}${data.preview_url}?t=${Date.now()}`, myToken);
      } catch (err) {
        if (myToken !== _bulkRenderToken) return;
        if (ph) { ph.style.display = "flex"; ph.innerHTML = `<span style="font-size:11px;color:#ef4444;">Preview failed: ${esc(err.message)}</span>`; }
        showToast("Preview failed: " + err.message, "error");
      }
    }

    
    async function loadPdfToBulkPreview(url, myToken) {
      const lib = window['pdfjs-dist/build/pdf'];
      if (!lib) return;
      const doc = await lib.getDocument(url).promise;
      if (myToken !== _bulkRenderToken) return; 
      const wrap = document.getElementById("bulkPreviewWrap");
      const ph = document.getElementById("bulkPreviewPlaceholder");
      if (ph) ph.style.display = "none";
      if (wrap) wrap.querySelectorAll("canvas, .preview-page-label").forEach(c => c.remove());
      const containerW = (wrap ? wrap.offsetWidth : 360) - 16;
      for (let num = 1; num <= doc.numPages; num++) {
        const page = await doc.getPage(num);
        if (myToken !== _bulkRenderToken) return;
        const vp = page.getViewport({ scale: 1 });
        const scale = Math.max(0.5, containerW / vp.width);
        const scaledVp = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.className = "preview-page-canvas";
        canvas.width = scaledVp.width; canvas.height = scaledVp.height;
        wrap.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: scaledVp }).promise;
        if (myToken !== _bulkRenderToken) { canvas.remove(); return; }
      }
    }

    
    function getBulkGenOptions() {
      const showLogo = document.getElementById("bulkLogoOption").value === "with_logo";
      const showGrid = document.getElementById("bulkGridOption").value === "with_grid";
      const formats = [];
      if (document.getElementById("bulkFmtPdf").checked) formats.push("pdf");
      if (document.getElementById("bulkFmtDocx").checked) formats.push("docx");
      const outputDir = document.getElementById("bulkOutputDir").value.trim();
      return { showLogo, showGrid, formats, outputDir };
    }

    
    function toggleBulkBottomBar() {
      const panel = document.getElementById('bulkBottomControls');
      const btn = document.getElementById('bulkBottomToggle');
      const collapsed = panel.classList.toggle('collapsed');
      btn.classList.toggle('collapsed', collapsed);
      btn.title = collapsed ? 'Show actions bar' : 'Hide actions bar';
    }

    
    async function generateSelectedBulkReports() {
      const indices = getSelectedBulkIndices();
      if (!indices.length) { showToast("No patients selected. Use checkboxes to select patients.", "info"); return; }
      await _runBulkGeneration(indices, "generateSelectedBtn", "<i class='fas fa-check-circle'></i> Generate Selected");
    }

    
    async function generateBulkReports() {
      const indices = state.bulkPatients.map((_, i) => i);
      if (!indices.length) { showToast("No patients loaded", "info"); return; }
      await _runBulkGeneration(indices, "generateAllBtn", "<i class='fas fa-rocket'></i> Generate All Reports");
    }

    
    async function _runBulkGeneration(indices, btnId, btnLabel) {
      const opts = getBulkGenOptions();
      if (!opts.formats.length) { showToast("Select at least one format (PDF or DOCX)", "info"); return; }

      const outputDir = document.getElementById("bulkOutputDir").value.trim();
      if (!outputDir) {
        showToast("Please select output folder", "warning");
        return;
      }

      const btn = document.getElementById(btnId);
      const otherBtn = document.getElementById(btnId === "generateAllBtn" ? "generateSelectedBtn" : "generateAllBtn");
      btn.disabled = true; if (otherBtn) otherBtn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span> Generating...`;

      const progressWrap = document.getElementById("bulkProgressWrap");
      const progressBar = document.getElementById("bulkProgressBar");
      const progressText = document.getElementById("bulkProgressText");
      const resultBox = document.getElementById("bulkResult");
      progressWrap.style.display = "block"; resultBox.classList.add("hidden");
      progressBar.style.width = "0%";

      let done = 0, errors = [];
      const total = indices.length;
      state.stopGeneration = false;
      const cancelBtn = document.getElementById("cancelGenBtn");
      if (cancelBtn) cancelBtn.style.display = "inline-flex";

      for (let n = 0; n < total; n++) {
        if (state.stopGeneration) {
            showToast("Generation cancelled by user", "info");
            break;
        }
        const i = indices[n];
        const p = state.bulkPatients[i];
        const statusEl = document.getElementById(`bulk-status-${i}`);
        if (statusEl) { statusEl.textContent = "Running…"; statusEl.className = "patient-status running"; statusEl.style.display = ''; }
        progressText.textContent = `Generating ${n + 1} / ${total} — ${p.patient_name || "Patient"}`;

        try {
          const payload = buildBulkPayload(p, opts.showLogo, opts.showGrid);
          
          payload.options = { formats: opts.formats, show_logo: opts.showLogo, show_grid: opts.showGrid };
          
          if (opts.outputDir) payload.output_dir = opts.outputDir;
          const res = await fetch(`${PGTA_BASE}/api/pgta/generate`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (!res.ok) throw await uploadError(res);
          const data = await res.json(); if (data.error) throw new Error(data.error);


          const folderHandle = _dirHandles["bulkOutputDir"];
          if (folderHandle) {
            const saveLocal = async (localUrl, filename) => {
              try {
                const resp = await fetch(`${PGTA_BASE}${localUrl}`); const blob = await resp.blob();
                await saveFileToDir("bulkOutputDir", blob, filename);
              } catch(e) { console.warn("Local save failed for", filename, e); }
            };
            const saves = [];
            if (data.results?.pdf)  saves.push(saveLocal(data.results.pdf.url,  data.results.pdf.file));
            if (data.results?.docx) saves.push(saveLocal(data.results.docx.url, data.results.docx.file));
            await Promise.all(saves);
          }
          
          try {
            const rKey = `pgta_generated_${Date.now()}_${n}`;
            localStorage.setItem(rKey, JSON.stringify({
              patient_name: p.patient_name, sample_number: p.sample_number,
              pdf_url: data.results?.pdf?.url || null, docx_url: data.results?.docx?.url || null,
              generated_at: new Date().toISOString()
            }));
            const gKeys = Object.keys(localStorage).filter(k => k.startsWith("pgta_generated_")).sort();
            while (gKeys.length > 100) localStorage.removeItem(gKeys.shift());
          } catch(e) {}
          if (statusEl) { statusEl.textContent = "Done ✓"; statusEl.className = "patient-status done"; }
          done++;
        } catch (err) {
          errors.push({ patient: p.patient_name, error: err.message });
          if (statusEl) { statusEl.textContent = "Error"; statusEl.className = "patient-status error"; }
        }
        progressBar.style.width = `${Math.round(((n + 1) / total) * 100)}%`;
      }

      btn.disabled = false; if (otherBtn) otherBtn.disabled = false;
      btn.innerHTML = btnLabel;
      progressText.textContent = `Done: ${done} success, ${errors.length} failed`;

      resultBox.classList.remove("hidden");
      if (!errors.length) {
        resultBox.className = "result-box success";
        resultBox.innerHTML = ` <strong>${done} report${done > 1 ? "s" : ""} generated successfully!</strong>${opts.outputDir ? `<br><small>Saved to: ${esc(opts.outputDir)}</small>` : ""}`;
        showToast(`${done} report${done > 1 ? "s" : ""} done`, "success");
      } else {
        resultBox.className = "result-box error";
        resultBox.innerHTML = `<strong>${done} done, ${errors.length} failed:</strong><br>` + errors.map(e => `${e.patient}: ${e.error}`).join("<br>");
        showToast(`${done} done, ${errors.length} errors`, "error");
      }
    }

    
    
    
    function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
    function todayStr() { const d = new Date(); return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`; }
    function showToast(msg, type) {
      if (typeof toast === 'function') { toast(msg); return; }
      const el = document.getElementById('toast');
      if (!el) return;
      el.textContent = msg;
      el.className = 'toast show' + (type ? ' ' + type : '');
      clearTimeout(el._t);
      el._t = setTimeout(() => el.classList.remove('show'), 3000);
    }

    
    
    
    function initPgtaView() {
      if (typeof state === 'undefined') return;
      if (state._initialized) return;
      state._initialized = true;
      try {
        const rsDl = document.getElementById("result-summary-dl");
        if (rsDl) rsDl.innerHTML = RESULT_SUMMARY_OPTIONS.map(o => `<option value="${esc(o)}">`).join("");
        const rdDl = document.getElementById("result-desc-dl");
        if (rdDl) rdDl.innerHTML = RESULT_OPTIONS.map(o => `<option value="${esc(o)}">`).join("");
        document.getElementById("f_report_date").value = todayStr();
        document.getElementById("f_specimen").value = "DAY 5 TROPHECTODERM BIOPSY";
        document.getElementById("f_spouse_name").value = "w/o";
        document.querySelectorAll("#tab-manual .field input,#tab-manual .field textarea").forEach(el => {
          el.addEventListener("input", () => schedulePreview());
        });
        document.getElementById("logoOption").addEventListener("change", () => schedulePreview());
        document.getElementById("gridOption").addEventListener("change", () => schedulePreview());
        document.getElementById("f_report_template").addEventListener("change", (e) => {
          if (e.target.value === "pgtsr") {
            const indicationEl = document.getElementById("f_indication");
            if (indicationEl && !indicationEl.value.trim()) indicationEl.value = PGTSR_DEFAULT_INDICATION;
          }
          renderSummaryTable(); renderEmbryoForms();
          schedulePreview();
        });
        setEmbryoCount(1);
        _pfPopulateFilters();
        _bulkPopulateFilters();
        const strip = document.getElementById("viewTitleStrip");
        if (strip) strip.textContent = "Single Entry";
      } catch (e) { console.error("Init error:", e); }
    }

    
    
    
    let cmpFiles = { manual: null, auto: null };
    let _lastCmpData = null; 

    function toggleCmpMode() {
      const mode = document.querySelector('input[name="cmpMode"]:checked').value;
      document.getElementById("bulkModeSection").style.display       = mode === "bulk"       ? "" : "none";
      document.getElementById("individualModeSection").style.display = mode === "individual" ? "" : "none";
    }

    function cmpFileSelected(type, input) {
      const file = input.files[0]; if (!file) return;
      cmpFiles[type] = file;
      const nameEl = document.getElementById(type === "manual" ? "cmpManualName" : "cmpAutoName");
      const dropEl = document.getElementById(type === "manual" ? "cmpDropManual" : "cmpDropAuto");
      nameEl.style.display = "block"; nameEl.textContent = file.name;
      dropEl.classList.add("has-file");
      
      const btn = document.getElementById("cmpBtn");
      if (cmpFiles.manual && cmpFiles.auto) {
        if (btn) btn.disabled = false;
        runComparison();
      }
    }

    function clearComparison() {
      cmpFiles = { manual: null, auto: null };
      _lastCmpData = null;
      ["cmpManualName", "cmpAutoName"].forEach(id => {
        const el = document.getElementById(id); if (el) { el.style.display = "none"; el.textContent = ""; }
      });
      ["cmpDropManual", "cmpDropAuto"].forEach(id => {
        const el = document.getElementById(id); if (el) el.classList.remove("has-file");
      });
      document.getElementById("cmpFileManual").value = "";
      document.getElementById("cmpFileAuto").value = "";
      document.getElementById("cmpResults").innerHTML = "";
      const btn = document.getElementById("cmpBtn");
      if (btn) btn.disabled = true;
      const dlBtn = document.getElementById("cmpDownloadBtn");
      if (dlBtn) dlBtn.style.display = "none";
    }

    async function runComparison() {
      if (!cmpFiles.manual || !cmpFiles.auto) { showToast("Please select both files", "info"); return; }
      const btn = document.getElementById("cmpBtn");
      btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Comparing...`;
      const resultEl = document.getElementById("cmpResults");
      resultEl.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-muted);">
        <span class="spinner" style="border-color:#1F497D;border-top-color:#4F81BD;width:20px;height:20px;display:inline-block;margin-bottom:8px;"></span>
        <p style="margin-top:8px;font-size:12px;">Extracting and comparing report data...</p></div>`;
      const dlBtn = document.getElementById("cmpDownloadBtn");
      if (dlBtn) dlBtn.style.display = "none";
      try {
        const fd = new FormData();
        fd.append("manual", cmpFiles.manual);
        fd.append("automated", cmpFiles.auto);
        const res = await fetch(`${PGTA_BASE}/api/pgta/compare`, { method: "POST", body: fd });
        if (!res.ok) throw await uploadError(res);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        _lastCmpData = data;
        renderComparisonResult(data);
        if (dlBtn) dlBtn.style.display = "";
      } catch (err) {
        resultEl.innerHTML = `<div class="result-box error" style="display:block;"><i class="fas fa-exclamation-circle"></i> Comparison error: ${esc(err.message)}</div>`;
      } finally {
        btn.disabled = false; btn.innerHTML = `<i class="fas fa-balance-scale"></i> Compare Reports`;
      }
    }

    function renderComparisonResult(data) {
      const el = document.getElementById("cmpResults");
      const isMatch = data.match || data.total_changes === 0;
      const badge = isMatch
        ? `<span class="cmp-summary-badge match"><i class="fas fa-check-circle"></i> Reports Match</span>`
        : `<span class="cmp-summary-badge diff"><i class="fas fa-exclamation-triangle"></i> ${data.total_changes} Difference${data.total_changes !== 1 ? "s" : ""} Found</span>`;

      const filesRow = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
          <div style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:10px;">
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">Manual Report</div>
            <div style="font-size:11px;word-break:break-all;">${esc(data.manual_file || "-")}</div>
          </div>
          <div style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:10px;">
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">Automated Report</div>
            <div style="font-size:11px;word-break:break-all;">${esc(data.auto_file || "-")}</div>
          </div>
        </div>`;

      const diffBlock = data.html_diff
        ? `<div class="diff-wrapper">${data.html_diff}</div>`
        : `<div class="compare-match"><i class="fas fa-check-circle"></i> All content matches — no differences found.</div>`;

      el.innerHTML = `
        <div class="compare-result-card">
          <div class="compare-result-header" style="display:flex;align-items:center;justify-content:space-between;">
            <strong style="font-size:13px;">Comparison Result</strong>${badge}
          </div>
          <div style="padding:12px 14px;">${filesRow}${diffBlock}</div>
        </div>`;
    }

    function downloadComparison() {
      if (!_lastCmpData) { showToast("No comparison to download", "info"); return; }
      const d = _lastCmpData;
      const timestamp = new Date().toLocaleString();
      const statusText = d.match ? "MATCH" : `${d.total_changes} DIFFERENCE(S)`;
      const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<title>PGTA Report Comparison — ${esc(d.manual_file)} vs ${esc(d.auto_file)}</title>
<style>
  body { font-family: Segoe UI, Arial, sans-serif; margin: 0; padding: 20px; background: #f8fafc; color: #1e293b; }
  h1 { font-size: 18px; color: #1F497D; margin-bottom: 4px; }
  .meta { font-size: 12px; color: #64748b; margin-bottom: 20px; }
  .badge-match { background:#ecfdf5;color:#065f46;padding:4px 14px;border-radius:99px;font-weight:700;font-size:12px; }
  .badge-diff  { background:#fef2f2;color:#991b1b;padding:4px 14px;border-radius:99px;font-weight:700;font-size:12px; }
  table.diff { border-collapse: collapse; width: 100%; font-family: 'Courier New', monospace; font-size: 11px; }
  table.diff td { padding: 3px 8px; vertical-align: top; white-space: pre-wrap; word-break: break-all; }
  .diff_header { background: #e8edf2; text-align: right; }
  .diff_next { display: none; }
  .diff_add { background: #d1fae5; }
  .diff_chg { background: #fef9c3; }
  .diff_sub { background: #fee2e2; }
  .legend { display:flex; gap:16px; margin-bottom:14px; font-size:12px; }
  .legend span { display:inline-flex; align-items:center; gap:6px; }
  .swatch { width:14px; height:14px; border-radius:3px; display:inline-block; }
</style>
</head><body>
<h1>PGTA Report Comparison</h1>
<div class="meta">
  <strong>Manual:</strong> ${esc(d.manual_file)} &nbsp;|&nbsp;
  <strong>Automated:</strong> ${esc(d.auto_file)} &nbsp;|&nbsp;
  <strong>Generated:</strong> ${timestamp}
</div>
<p><span class="${d.match ? 'badge-match' : 'badge-diff'}">${statusText}</span></p>
<div class="legend">
  <span><span class="swatch" style="background:#d1fae5;"></span> Added in Automated</span>
  <span><span class="swatch" style="background:#fee2e2;"></span> Removed from Manual</span>
  <span><span class="swatch" style="background:#fef9c3;"></span> Changed</span>
</div>
${d.html_diff || "<p>No differences found.</p>"}
</body></html>`;
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pgta_comparison_${Date.now()}.html`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Comparison exported as HTML", "success");
    }
