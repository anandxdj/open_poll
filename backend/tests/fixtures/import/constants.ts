/** What generate.ts writes into sample.pdf and sample.pptx; tests assert against these. */
export const SAMPLE_PDF = {
  pages: [
    { title: 'Import fixture', body: 'Rendered with pdfkit for the unpdf spike.' },
    { title: 'Second page', body: '' },
  ],
  /** A filled #ff0000 square on page 1, in PDF points from the top-left corner. */
  redSquare: { x: 24, y: 200, size: 60 },
  /** A6 in PDF points. */
  pageSize: { width: 297.64, height: 419.53 },
} as const;

export const SAMPLE_PPTX = {
  title: 'OpenPoll import fixture',
  /** In deck order (sldIdLst), not part-name order. */
  slides: [
    { title: 'Quarterly review', bullets: [] },
    {
      title: 'Agenda',
      bullets: [
        { text: 'Results', level: 0 },
        { text: 'Revenue & churn', level: 1 },
        { text: 'Next steps', level: 0 },
      ],
    },
  ],
} as const;
