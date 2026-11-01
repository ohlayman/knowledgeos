export function NodeIcon({ type }: { type: string }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 14 14',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.3,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'data-testid': `node-icon-${type}`,
    'aria-hidden': true,
  };

  switch (type) {
    case 'technology':
      return (
        <svg {...common} x={-7} y={-7}>
          <rect x="2" y="2" width="10" height="10" rx="2" />
        </svg>
      );
    case 'project':
      return (
        <svg {...common} x={-7} y={-7}>
          <path d="M1.5 4.5h4l1.3 1.5h5.7v5.5H1.5z" />
        </svg>
      );
    case 'agent':
      return (
        <svg {...common} x={-7} y={-7}>
          <rect x="2.5" y="3.5" width="9" height="7" rx="2" />
          <circle cx="5.5" cy="7" r="0.8" />
          <circle cx="8.5" cy="7" r="0.8" />
          <path d="M7 1.8v1.7" />
        </svg>
      );
    case 'protocol':
      return (
        <svg {...common} x={-7} y={-7}>
          <circle cx="3" cy="4" r="1.4" />
          <circle cx="11" cy="10" r="1.4" />
          <path d="M4.3 4.8 9.7 9.2" />
        </svg>
      );
    default:
      return (
        <svg {...common} x={-7} y={-7}>
          <circle cx="7" cy="7" r="2.2" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}
