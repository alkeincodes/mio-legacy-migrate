const QUERY_STRING = /(\?)[^\s"'<>]+/g;

export function createRedactor(secrets: string[]): (text: string) => string {
  const usable = secrets
    .filter((s) => s.trim().length > 0)
    .sort((a, b) => b.length - a.length);
  return (text: string): string => {
    let out = text;
    for (const secret of usable) out = out.split(secret).join('[REDACTED]');
    return out.replace(QUERY_STRING, '?[REDACTED-QUERY]');
  };
}
