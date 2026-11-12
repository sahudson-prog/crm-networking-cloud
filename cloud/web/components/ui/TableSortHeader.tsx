import { Icon } from "./Icon";

/** Shared ContactTable header: native button, existing styling and sort icons. */
export function TableSortHeader<Key extends string>({ current, label, onSort, sortKey }: {
  current: { key: Key; direction: "asc" | "desc" };
  label: string;
  onSort: (key: Key) => void;
  sortKey: Key;
}) {
  const active = current.key === sortKey;
  return <th aria-sort={active ? current.direction === "asc" ? "ascending" : "descending" : "none"}>
    <button className={`contacts-sort-header ${active ? "active" : ""}`}
      onClick={() => onSort(sortKey)} title={`Ordenar por ${label}`} type="button">
      <span>{label}</span>
      {active ? <Icon name={current.direction === "asc" ? "sortAsc" : "sortDesc"} /> : null}
    </button>
  </th>;
}
