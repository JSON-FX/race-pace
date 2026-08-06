import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useTableParams } from "../lib/useTableParams";

function Probe() {
  const t = useTableParams({ sort: [{ id: "created_at", desc: true }] });
  return (
    <div>
      <span data-testid="page">{t.page}</span>
      <span data-testid="sort">{t.sort.map((s) => `${s.id}:${s.desc ? "desc" : "asc"}`).join(",")}</span>
      <span data-testid="status">{t.filters.status ?? ""}</span>
      <span data-testid="q">{t.q}</span>
      <button onClick={() => t.setPage(3)}>page3</button>
      <button onClick={() => t.setFilter("status", "refunded")}>filter</button>
      <button onClick={() => t.setSort([{ id: "amount", desc: false }])}>sort</button>
      <button onClick={() => t.setQ("ben")}>setq</button>
    </div>
  );
}

const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><Probe /></MemoryRouter>);

it("defaults page to 1 and applies the default sort", () => {
  at("/payments");
  expect(screen.getByTestId("page")).toHaveTextContent("1");
  expect(screen.getByTestId("sort")).toHaveTextContent("created_at:desc");
});

it("reads page, sort, filters and search from the URL", () => {
  at("/payments?page=4&sort=amount:asc&status=paid&q=ana");
  expect(screen.getByTestId("page")).toHaveTextContent("4");
  expect(screen.getByTestId("sort")).toHaveTextContent("amount:asc");
  expect(screen.getByTestId("status")).toHaveTextContent("paid");
  expect(screen.getByTestId("q")).toHaveTextContent("ana");
});

it("writes page and sort back to the URL", () => {
  at("/payments");
  fireEvent.click(screen.getByText("page3"));
  expect(screen.getByTestId("page")).toHaveTextContent("3");
  fireEvent.click(screen.getByText("sort"));
  expect(screen.getByTestId("sort")).toHaveTextContent("amount:asc");
});

it("resets to page 1 when a filter changes", () => {
  at("/payments?page=5");
  fireEvent.click(screen.getByText("filter"));
  expect(screen.getByTestId("page")).toHaveTextContent("1");
  expect(screen.getByTestId("status")).toHaveTextContent("refunded");
});

it("resets to page 1 when the search query changes", () => {
  at("/payments?page=5");
  fireEvent.click(screen.getByText("setq"));
  expect(screen.getByTestId("page")).toHaveTextContent("1");
  expect(screen.getByTestId("q")).toHaveTextContent("ben");
});

it("resets to page 1 when sort changes", () => {
  at("/payments?page=5");
  fireEvent.click(screen.getByText("sort"));
  expect(screen.getByTestId("page")).toHaveTextContent("1");
  expect(screen.getByTestId("sort")).toHaveTextContent("amount:asc");
});
