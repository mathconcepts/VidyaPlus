import type { CheckResult } from '../api/types';

/**
 * Props for the element that shows a result's explanation. `reasonHtml` is the brain's pre-rendered,
 * server-sanitised KaTeX HTML (E5/E8); only that field is ever set as innerHTML. Without it the plain
 * `reason` is shown as text.
 */
export function reasonProps(r: Pick<CheckResult, 'reason' | 'reasonHtml'>): { children: string } | { dangerouslySetInnerHTML: { __html: string } } {
  return r.reasonHtml !== undefined ? { dangerouslySetInnerHTML: { __html: r.reasonHtml } } : { children: r.reason };
}
