import { useMemo } from "react";
import { scaleLinear, scaleTime } from "d3-scale";
import { line } from "d3-shape";
import { extent, max } from "d3-array";

type EcpmDataPoint = {
  date: string;
  ads_watched: number;
  total_points: number;
  ecpm_ngn: number;
};

type EcpmTrendChartProps = {
  data: EcpmDataPoint[];
  height?: number;
};

export function EcpmTrendChart({ data, height = 300 }: EcpmTrendChartProps) {
  const { width, path, xTicks, yTicks, maxEcpm } = useMemo(() => {
    const width = 800;
    const margin = { top: 20, right: 30, bottom: 40, left: 60 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Sort data by date (newest first from API, reverse for chart)
    const sortedData = [...data].reverse();

    // Parse dates
    const parsedData = sortedData.map((d) => ({
      ...d,
      parsedDate: new Date(d.date),
    }));

    // Scales
    const xExtent = extent(parsedData, (d) => d.parsedDate) as [Date, Date];
    const xScale = scaleTime()
      .domain(xExtent)
      .range([margin.left, width - margin.right]);

    const maxEcpm = max(parsedData, (d) => d.ecpm_ngn) || 10;
    const yScale = scaleLinear()
      .domain([0, maxEcpm * 1.1]) // Add 10% padding
      .range([height - margin.bottom, margin.top]);

    // Line generator
    const lineGenerator = line<(typeof parsedData)[0]>()
      .x((d) => xScale(d.parsedDate))
      .y((d) => yScale(d.ecpm_ngn));

    const path = lineGenerator(parsedData) || "";

    // Ticks
    const xTicks = xScale.ticks(5);
    const yTicks = yScale.ticks(5);

    return {
      width,
      path,
      xTicks,
      yTicks,
      maxEcpm,
      xScale,
      yScale,
      margin,
      parsedData,
    };
  }, [data, height]);

  if (data.length === 0) {
    return <div className="text-text-muted">No data to display</div>;
  }

  const { xScale, yScale, margin, parsedData } = useMemo(() => {
    const margin = { top: 20, right: 30, bottom: 40, left: 60 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const sortedData = [...data].reverse();
    const parsedData = sortedData.map((d) => ({
      ...d,
      parsedDate: new Date(d.date),
    }));

    const xExtent = extent(parsedData, (d) => d.parsedDate) as [Date, Date];
    const xScale = scaleTime()
      .domain(xExtent)
      .range([margin.left, width - margin.right]);

    const maxEcpm = max(parsedData, (d) => d.ecpm_ngn) || 10;
    const yScale = scaleLinear()
      .domain([0, maxEcpm * 1.1])
      .range([height - margin.bottom, margin.top]);

    return { xScale, yScale, margin, parsedData };
  }, [data, height, width]);

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
    >
      {/* Y-axis grid lines */}
      {yTicks.map((tick) => (
        <line
          key={tick}
          x1={margin.left}
          x2={width - margin.right}
          y1={yScale(tick)}
          y2={yScale(tick)}
          stroke="currentColor"
          strokeOpacity={0.1}
          className="text-border"
        />
      ))}

      {/* Line path */}
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="text-blue-500"
      />

      {/* Data points */}
      {parsedData.map((d, i) => (
        <circle
          key={i}
          cx={xScale(d.parsedDate)}
          cy={yScale(d.ecpm_ngn)}
          r={4}
          fill="currentColor"
          className="text-blue-500"
        />
      ))}

      {/* X-axis */}
      <g transform={`translate(0,${height - margin.bottom})`}>
        <line
          x1={margin.left}
          x2={width - margin.right}
          stroke="currentColor"
          className="text-border"
        />
        {xTicks.map((tick) => (
          <g key={tick.getTime()} transform={`translate(${xScale(tick)},0)`}>
            <line y2={6} stroke="currentColor" className="text-border" />
            <text
              y={20}
              textAnchor="middle"
              fontSize={12}
              fill="currentColor"
              className="text-text-muted"
            >
              {tick.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </text>
          </g>
        ))}
      </g>

      {/* Y-axis */}
      <g transform={`translate(${margin.left},0)`}>
        <line
          y1={margin.top}
          y2={height - margin.bottom}
          stroke="currentColor"
          className="text-border"
        />
        {yTicks.map((tick) => (
          <g key={tick} transform={`translate(0,${yScale(tick)})`}>
            <line x2={-6} stroke="currentColor" className="text-border" />
            <text
              x={-10}
              textAnchor="end"
              alignmentBaseline="middle"
              fontSize={12}
              fill="currentColor"
              className="text-text-muted"
            >
              ₦{tick.toFixed(2)}
            </text>
          </g>
        ))}
      </g>

      {/* Y-axis label */}
      <text
        x={-height / 2}
        y={15}
        transform="rotate(-90)"
        textAnchor="middle"
        fontSize={12}
        fill="currentColor"
        className="text-text-muted"
      >
        eCPM (NGN)
      </text>
    </svg>
  );
}
