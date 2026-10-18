import { useParams, useResolvedPath } from 'react-router';
import RepairList from './list.js';
export default function RelatedList() {
  const p = useParams(),
    path = useResolvedPath('.').pathname;
  const kind = path.startsWith('/assets/')
    ? 'asset'
    : path.startsWith('/merchants/')
      ? 'merchant'
      : 'contract';
  return <RepairList scope={{ kind, id: p.id ?? '' }} />;
}
