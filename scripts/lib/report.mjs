export function formatResult({ status, name, detail, hint }) {
  const line = `${status.padEnd(6)}${name}${detail ? ` (${detail})` : ""}`;
  return hint ? `${line}\n      fix: ${hint}` : line;
}

export function report(result) {
  console.log(formatResult(result));
  return result;
}
