import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import type { UserSegments } from "@/lib/types";
import { Card, ShimmerLoader, Container } from "@/shared/components";
import { TopHeader } from "@/shared/components/TopHeader";
import { useLayoutContext } from "@/shared/components/Layout";

export function SegmentsPage() {
  const { onMenuClick } = useLayoutContext();

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "users", "segments"],
    queryFn: async () => {
      const { data } = await adminApi.get<UserSegments>(
        "/admin/segments",
      );
      return data;
    },
    staleTime: 60_000,
  });

  const segments = data
    ? [
        { label: "Total Users", value: data.total_users, hint: "All registered users" },
        {
          label: "High-Value Users",
          value: data.high_value_users,
          hint: ">1000 rewarded ads watched",
        },
        {
          label: "Power Readers",
          value: data.power_readers,
          hint: ">50 reading sessions",
        },
        {
          label: "Premium Users",
          value: data.premium_users,
          hint: "Any paid tier",
        },
        {
          label: "New Users (7d)",
          value: data.new_users_7d,
          hint: "Signed up in last 7 days",
        },
        {
          label: "At-Risk Users (7–30d)",
          value: data.at_risk_users_7_30d,
          hint: "Last active 7–30 days ago",
        },
      ]
    : [];

  return (
    <>
      <TopHeader
        title="User Segments"
        subtitle="Behavioral cohort sizes (read-only)"
        onMenuClick={onMenuClick}
      />
      <Container size="lg">
        <div className="space-y-6">
          {isLoading && (
            <Card className="p-4">
              <ShimmerLoader lines={4} />
            </Card>
          )}
          {error && (
            <Card className="p-4 text-error">Failed to load segments</Card>
          )}
          {data && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {segments.map((s) => (
                <Card key={s.label} className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    {s.label}
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-text-main">
                    {s.value.toLocaleString()}
                  </p>
                  <p className="mt-1 text-xs text-text-muted">{s.hint}</p>
                </Card>
              ))}
            </div>
          )}
        </div>
      </Container>
    </>
  );
}
