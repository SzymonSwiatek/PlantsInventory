// Pin the process timezone to UTC before any test reads `Date`. The date
// normalizer's non-ISO fallback (`new Date(<arbitrary>)`) parses as local time
// then shifts to UTC via `.toISOString()`, so an unpinned host timezone would
// make those assertions flaky cross-machine (see plan §"Critical Implementation
// Details").
process.env.TZ = "UTC";
