import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import type { DailyActiveUsers } from '@/lib/types';

interface BarChartProps {
  data: DailyActiveUsers[];
  /**
   * Fallback width used when the container has not been measured yet
   * (e.g. on the very first render before the ResizeObserver fires).
   * Once the container is measured, the chart self-sizes to the parent.
   */
  width?: number;
  height?: number;
  className?: string;
}

export function BarChart({ data, width = 700, height = 300, className = '' }: BarChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);

  // Observe the container and update measured width on resize.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setMeasuredWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!svgRef.current || !data.length) return;

    // Prefer the measured container width; fall back to the prop until
    // the first measurement lands (or in tests / non-DOM environments).
    const effectiveWidth = measuredWidth || width;
    if (!effectiveWidth) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 20, right: 20, bottom: 40, left: 50 };
    const innerWidth = effectiveWidth - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg
      .attr('width', effectiveWidth)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleBand()
      .domain(data.map((d) => d.date))
      .range([0, innerWidth])
      .padding(0.2);

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => d.count) || 0])
      .nice()
      .range([innerHeight, 0]);

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).tickSizeOuter(0))
      .selectAll('text')
      .attr('fill', '#6B7280')
      .style('font-size', '12px');

    g.append('g')
      .call(d3.axisLeft(y).ticks(5))
      .selectAll('text')
      .attr('fill', '#6B7280')
      .style('font-size', '12px');

    g.selectAll('.domain').attr('stroke', '#E5E2DA');
    g.selectAll('.tick line').attr('stroke', '#E5E2DA');

    g.selectAll('rect')
      .data(data)
      .enter()
      .append('rect')
      .attr('x', (d) => x(d.date) || 0)
      .attr('y', innerHeight)
      .attr('width', x.bandwidth())
      .attr('height', 0)
      .attr('fill', '#0E7C66')
      .attr('rx', 4)
      .transition()
      .duration(600)
      .attr('y', (d) => y(d.count))
      .attr('height', (d) => innerHeight - y(d.count));

    g.selectAll('.bar-label')
      .data(data)
      .enter()
      .append('text')
      .attr('class', 'bar-label')
      .attr('x', (d) => (x(d.date) || 0) + x.bandwidth() / 2)
      .attr('y', (d) => y(d.count) - 6)
      .attr('text-anchor', 'middle')
      .attr('fill', '#0E1116')
      .style('font-size', '12px')
      .style('font-weight', '500')
      .text((d) => d.count);
  }, [data, measuredWidth, width, height]);

  return (
    <div ref={containerRef} className={`w-full ${className}`}>
      <svg ref={svgRef} />
    </div>
  );
}
