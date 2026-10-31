export function normalizeUrl(input: string): string {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new Error('invalid url');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('only http/https urls are supported');
  }

  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }

  return url.toString();
}
