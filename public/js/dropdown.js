// Custom dropdown: enhances <select data-fancy> into a styled combobox.
// W3C APG "select-only combobox" keyboard pattern. The native select stays in
// the DOM (hidden) as the form control and no-JS fallback. Touch devices keep
// the native control — the OS picker sheet beats any web panel on a phone.
(function () {
  // Filter forms: submit on committed selection. The fancy dropdown below
  // dispatches change only on click/Enter/Tab — not while arrow-keying the
  // open list (WCAG 3.2.2). Native <select> on touch gets the same via change.
  document.querySelectorAll("form[data-submit-on-change]").forEach(function (form) {
    form.querySelectorAll("select").forEach(function (sel) {
      sel.addEventListener("change", function () {
        form.submit();
      });
    });
    var btn = form.querySelector('button[type="submit"]');
    if (btn) btn.hidden = true;
  });

  if (window.matchMedia("(pointer: coarse)").matches) return;
  var uid = 0;

  document.querySelectorAll("select[data-fancy]").forEach(function (sel) {
    var id = "dd" + ++uid;
    var wrap = document.createElement("div");
    wrap.className = "dd";
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.tabIndex = -1;
    sel.setAttribute("aria-hidden", "true");

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dd-btn";
    btn.id = id + "-btn";
    btn.setAttribute("role", "combobox");
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    var labelledBy = sel.getAttribute("aria-labelledby");
    if (labelledBy) btn.setAttribute("aria-labelledby", labelledBy + " " + btn.id);

    var list = document.createElement("ul");
    list.className = "dd-list";
    list.id = id + "-list";
    list.setAttribute("role", "listbox");
    btn.setAttribute("aria-controls", list.id);

    var opts = Array.prototype.map.call(sel.options, function (o, i) {
      var li = document.createElement("li");
      li.setAttribute("role", "option");
      li.id = id + "-opt-" + i;
      li.textContent = o.textContent;
      if (i === sel.selectedIndex) li.setAttribute("aria-selected", "true");
      li.addEventListener("click", function () {
        choose(i);
        close();
        btn.focus();
      });
      li.addEventListener("mousemove", function () {
        setActive(i);
      });
      list.appendChild(li);
      return li;
    });

    var active = Math.max(0, sel.selectedIndex);
    var isOpen = false;
    var buffer = "";
    var bufferTimer = 0;

    function label() {
      var o = sel.options[sel.selectedIndex];
      btn.textContent = o ? o.textContent : "";
    }
    function choose(i) {
      sel.selectedIndex = i;
      opts.forEach(function (o, j) {
        if (j === i) o.setAttribute("aria-selected", "true");
        else o.removeAttribute("aria-selected");
      });
      label();
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function setActive(i) {
      if (i < 0) i = 0;
      if (i > opts.length - 1) i = opts.length - 1;
      opts[active] && opts[active].classList.remove("dd-active");
      active = i;
      opts[i].classList.add("dd-active");
      btn.setAttribute("aria-activedescendant", opts[i].id);
      opts[i].scrollIntoView({ block: "nearest" });
    }
    function openList() {
      isOpen = true;
      wrap.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
      setActive(Math.max(0, sel.selectedIndex));
    }
    function close() {
      isOpen = false;
      wrap.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
      btn.removeAttribute("aria-activedescendant");
    }
    function typeahead(ch) {
      clearTimeout(bufferTimer);
      buffer += ch.toLowerCase();
      bufferTimer = setTimeout(function () {
        buffer = "";
      }, 500);
      for (var i = 0; i < opts.length; i++) {
        var j = (active + 1 + i) % opts.length;
        if (opts[j].textContent.toLowerCase().indexOf(buffer) === 0) {
          if (!isOpen) openList();
          setActive(j);
          return;
        }
      }
    }

    btn.addEventListener("click", function () {
      isOpen ? close() : openList();
    });
    btn.addEventListener("keydown", function (e) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          isOpen ? setActive(active + 1) : openList();
          break;
        case "ArrowUp":
          e.preventDefault();
          isOpen ? setActive(active - 1) : openList();
          break;
        case "Home":
          if (isOpen) {
            e.preventDefault();
            setActive(0);
          }
          break;
        case "End":
          if (isOpen) {
            e.preventDefault();
            setActive(opts.length - 1);
          }
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (isOpen) {
            choose(active);
            close();
          } else {
            openList();
          }
          break;
        case "Escape":
          if (isOpen) {
            e.preventDefault();
            close();
          }
          break;
        case "Tab":
          if (isOpen) {
            choose(active);
            close();
          }
          break;
        default:
          if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) typeahead(e.key);
      }
    });
    document.addEventListener("click", function (e) {
      if (isOpen && !wrap.contains(e.target)) close();
    });

    wrap.appendChild(btn);
    wrap.appendChild(list);
    label();
  });
})();
