// Swap server-rendered UTC airtimes for the viewer's local time.
// Progressive enhancement: any <time data-localtime datetime="<UTC ISO>"> keeps
// its truthful "HH:MM UTC" text for no-JS clients, then we replace it in place
// with the visitor's local time (e.g. "8:00 PM"). The datetime is moved to the
// title so the absolute instant is still inspectable on hover.
//
// data-localtime="compact" drops a top-of-the-hour ":00" so a narrow time-rail
// reads "6 PM" instead of "6:00 PM" (half-hours stay "6:30 PM").
(function () {
  var nodes = document.querySelectorAll("time[data-localtime][datetime]");
  if (!nodes.length) return;
  var fmt;
  try {
    fmt = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" });
  } catch (e) {
    return; // ancient engine — leave the UTC fallback untouched
  }
  // Only collapse a top-of-the-hour ":00" in 12-hour locales, where the AM/PM
  // keeps it reading as a time ("6:00 PM" -> "6 PM"). In 24-hour locales "21:00"
  // -> "21" would look like a bare number, so leave those full.
  var hour12 = !!fmt.resolvedOptions().hour12;
  Array.prototype.forEach.call(nodes, function (el) {
    var iso = el.getAttribute("datetime");
    var d = new Date(iso);
    if (isNaN(d.getTime())) return;
    var out = fmt.format(d);
    if (hour12 && el.getAttribute("data-localtime") === "compact") {
      out = out.replace(/:00(?=\D|$)/, "");
    }
    el.textContent = out;
    if (!el.title) el.title = iso;
  });
})();
