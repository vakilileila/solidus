module.exports = [
{
  from: "/redirect1",
  to: "/"
}, {
  from: "/redirect2",
  to: "/",
  "start": "2000-1-1 00:00:00"
}, {
  from: "/redirect3",
  to: "/",
  "start": "3000-1-1 00:00:00"
}, {
  from: "/redirect4",
  to: "/",
  "end": "2000-1-1 00:00:00"
}, {
  from: "/redirect5",
  to: "/",
  "permanent": true
}, {
  from: "/redirect6/{dynamic}/{route}",
  to: "/new/{route}/{dynamic}"
}, {
  from: /\/redirect7\/(\d+)-\d+-(\d+)-(\d+)/,
  to: "/new/{1}/{0}/{2}"
}];