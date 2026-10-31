import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui.js';

export function NotFoundPage() {
  return (
    <div className="page">
      <EmptyState
        title="页面不存在"
        description="地址可能已失效，回到 Dashboard 继续。"
        action={
          <Link className="btn primary" to="/">
            回到 Dashboard
          </Link>
        }
      />
    </div>
  );
}
