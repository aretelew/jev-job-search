// Runs inside the page. A function, called by the fill runner with the fills
// of a plan produced by mapForm: [{ selector, kind, value, values? }]. Returns a JSON
// report of what was applied and what failed. To use it by hand in a browser
// console, wrap it in parentheses and call it with the array.
(fills) => {
  const report = { applied: [], failed: [] };
  // An attribute value inside a quoted CSS selector: backslashes and quotes escaped.
  const attr = (v) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const setNative = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
  };
  // Composed, as a person's typing is: a form drawn in web components listens outside the shadow root the box sits in.
  const fire = (el, types) => types.forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true, cancelable: true, composed: true })));
  // A selector reaches into a shadow root with " >>> ", as dumpFields.js wrote it (SmartRecruiters draws its form in web components).
  const q = (s) => { let el = null; let root = document; for (const part of s.split(" >>> ")) { if (!root) return null; el = root.querySelector(part); root = el && el.shadowRoot; } return el; };
  const deepAll = (sel, from = document) => { const out = []; const walk = (r) => { for (const el of r.querySelectorAll("*")) { if (el.matches(sel)) out.push(el); if (el.shadowRoot) walk(el.shadowRoot); } }; walk(from); return out; };
  const byId = (el, id) => { for (let r = el.getRootNode(); r; r = r instanceof ShadowRoot ? r.host.getRootNode() : null) { const n = r.getElementById(id); if (n) return n; } return null; };
  // The words of an option. One drawn in a web component shows the words the page slots into it.
  const words = (el) => {
    const own = el.innerText || el.textContent || "";
    if (own.trim() || !(el.getRootNode() instanceof ShadowRoot)) return own;
    return [...el.querySelectorAll("slot")].flatMap((s) => s.assignedNodes({ flatten: true })).map((n) => n.textContent || "").join(" ");
  };
  const labelFor = (el) => (el.id && el.getRootNode().querySelector(`label[for="${CSS.escape(el.id)}"]`)) || null;
  const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  // The options of one question that a radio or checkbox is one of, found as dumpFields.js found them: by name, or for
  // a form that leaves the name off (Gem), the nameless options of the same kind in the nearest box holding more than one control.
  const optionGroup = (el) => {
    if (el.name) return [...el.getRootNode().querySelectorAll(`input[type=${el.type}][name="${attr(el.name)}"]`)];
    for (let cur = el.parentElement, depth = 0; cur && cur !== document.body && depth < 6; cur = cur.parentElement, depth++) {
      const controls = [...cur.querySelectorAll("input:not([type=hidden]), select, textarea")];
      if (controls.length > 1) return controls.every((c) => c.type === el.type && !c.name) ? controls : [el];
    }
    return [el];
  };

  for (const f of fills) {
    try {
      const el = q(f.selector);
      if (!el) { report.failed.push({ selector: f.selector, why: "not found" }); continue; }
      el.scrollIntoView({ block: "center" });
      if (f.kind === "select" && el.multiple && f.values && f.values.length) {
        // A list that takes several: exactly the wanted options end up selected, each matched by its text or its value.
        const want = f.values.map(norm);
        const on = [...el.options].filter((o) => want.includes(norm(o.text)) || f.values.includes(o.value));
        if (on.length < f.values.length) { report.failed.push({ selector: f.selector, why: "options not found: " + f.values.filter((v) => !on.some((o) => norm(o.text) === norm(v) || o.value === v)).join(" | ") }); continue; }
        [...el.options].forEach((o) => { o.selected = on.includes(o); });
        fire(el, ["input", "change"]);
      } else if (f.kind === "select") {
        const opt = [...el.options].find((o) => o.value === f.value) || [...el.options].find((o) => norm(o.text) === norm(f.value)) || [...el.options].find((o) => norm(o.text).includes(norm(f.value)));
        if (!opt) { report.failed.push({ selector: f.selector, why: "option not found: " + f.value }); continue; }
        setNative(el, opt.value);
        fire(el, ["input", "change"]);
      } else if (f.kind === "radio" && el.tagName !== "INPUT") {
        // A button group: click the button whose text matches.
        const buttons = [...el.querySelectorAll("button, [role=radio], [role=option]")];
        const want = norm(f.value);
        const btn = buttons.find((b) => norm(b.innerText || b.textContent) === want) || buttons.find((b) => norm(b.innerText || b.textContent).includes(want));
        if (!btn) { report.failed.push({ selector: f.selector, why: "button option not found: " + f.value }); continue; }
        // A row drawn around a real radio or checkbox: the box is what the form listens to.
        (btn.querySelector("input[type=radio], input[type=checkbox]") || btn).click();
      } else if (f.kind === "radio") {
        const group = optionGroup(el);
        const labelOf = (r) => { const l = labelFor(r) || r.closest("label") || r.parentElement; return norm(l && (l.innerText || l.textContent)); };
        let target = [...group].find((r) => labelOf(r) === norm(f.value));
        if (!target) target = [...group].find((r) => labelOf(r).includes(norm(f.value)));
        if (!target) target = [...group].find((r) => r.value === f.value && r.value !== "on");
        if (!target) { report.failed.push({ selector: f.selector, why: "radio option not found: " + f.value }); continue; }
        target.click();
        // A box that did not take the click is tried through its label. It is never ticked from script behind the
        // form's back: the page would show it and the form would not know.
        if (!target.checked) { const l = labelFor(target) || target.closest("label"); if (l) l.click(); }
        if (!target.checked) { report.failed.push({ selector: f.selector, why: "the option did not take a click" }); continue; }
      } else if (f.kind === "checkbox") {
        const want = /^(true|yes|1|on|checked)$/i.test(f.value);
        if (el.checked !== want) el.click();
        if (el.checked !== want) { const l = labelFor(el) || el.closest("label, [role=checkbox]"); if (l) l.click(); }
        if (el.checked !== want) { report.failed.push({ selector: f.selector, why: "the box did not take a click" }); continue; }
      } else if (f.kind === "combobox") {
        el.focus();
        el.click();
        setNative(el, f.value);
        fire(el, ["input", "change"]);
        // Most comboboxes (react-select, Ashby, Lever) render options synchronously after input.
        // A box in a web component names its list, which sits in a shadow root around it, with rows drawn in roots of their own.
        const OPTION = "[role=option], [class*=option i][id*=option i], li[class*=option i]";
        const listId = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
        const list = el.getRootNode() instanceof ShadowRoot && listId ? byId(el, listId) : null;
        // offsetParent is null across a shadow boundary, so a row there counts as seen when it is drawn at all.
        const options = list ? deepAll(OPTION, list).filter((o) => o.getClientRects().length > 0) : [...document.querySelectorAll(OPTION)].filter((o) => o.offsetParent !== null);
        const want = norm(f.value);
        const opt = options.find((o) => norm(words(o)) === want) || options.find((o) => norm(words(o)).startsWith(want)) || options.find((o) => norm(words(o)).includes(want)) || options[0];
        if (opt) {
          opt.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
          opt.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true }));
          opt.click();
        } else {
          el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
        }
        report.applied.push(f.selector + (opt ? " → " + words(opt).trim().slice(0, 40) : " (typed, no option list seen)"));
        continue;
      } else {
        el.focus();
        setNative(el, f.value);
        fire(el, ["input", "change"]);
        el.blur();
      }
      report.applied.push(f.selector);
    } catch (e) {
      report.failed.push({ selector: f.selector, why: String(e) });
    }
  }
  return JSON.stringify(report);
};
