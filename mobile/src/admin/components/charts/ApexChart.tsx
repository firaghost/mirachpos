import React, { useMemo } from 'react'
import { View, StyleSheet } from 'react-native'
import { WebView } from 'react-native-webview'
import { AdminColors } from '../../theme/colors'
import { useAppTheme } from '../../../theme/ThemeProvider'

export type ApexSeries = { name: string; data: (number | null)[] }
export type ApexChartProps = {
  type: 'bar' | 'line' | 'area'
  title?: string
  categories: string[]
  series: ApexSeries[]
  height?: number
  maxTicks?: number
  aovTooltip?: boolean
  dualY?: boolean
}

export function ApexChart({ type, title, categories, series, height = 180, maxTicks, aovTooltip, dualY }: ApexChartProps) {
  // Subscribe to theme so AdminColors updates and this component re-renders
  const { isDark } = useAppTheme()
  const html = useMemo(() => {
    const payload = {
      type,
      title,
      categories,
      series,
      maxTicks,
      aovTooltip,
      dualY,
      chartBg: AdminColors.card,
      fore: AdminColors.text,
      grid: AdminColors.border,
      label: AdminColors.subtext,
      colors: [AdminColors.accent, AdminColors.success, AdminColors.warning, AdminColors.accentMuted],
      mode: isDark ? 'dark' : 'light',
    }
    const payloadStr = JSON.stringify(payload)
    return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <style>
    html, body, #root { margin:0; padding:0; background:${payload.chartBg}; }
    #chart { padding: 6px 8px; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
</head>
<body>
  <div id="root">
    <div id="chart"></div>
  </div>
  <script>
    const payload = ${payloadStr};
    const options = {
      chart: { type: payload.type, height: ${height}, background: payload.chartBg, foreColor: payload.fore, toolbar: { show: false }, animations: { enabled: true } },
      theme: { mode: payload.mode },
      title: { text: payload.title || '', style: { color: payload.fore, fontSize: '12px', fontWeight: 600 } },
      grid: { borderColor: payload.grid },
      colors: payload.colors,
      series: payload.series,
      markers: { size: 3, strokeWidth: 2, strokeColors: [payload.chartBg], colors: payload.colors },
      xaxis: {
        categories: payload.categories,
        tickAmount: payload.maxTicks && payload.maxTicks > 0 ? Math.min(payload.maxTicks, payload.categories.length) : Math.min(8, payload.categories.length),
        labels: { rotate: -35, style: { colors: payload.label } },
        axisBorder: { color: payload.grid },
        axisTicks: { color: payload.grid }
      },
      yaxis: payload.dualY ? [
        {
          seriesName: (payload.series && payload.series[0] && payload.series[0].name) || 'Series 1',
          labels: { formatter: (v) => (typeof v === 'number' ? (v >= 1000 ? Math.round(v/1000)+'k' : Math.round(v)) : v), style: { colors: payload.label } },
        },
        {
          seriesName: (payload.series && payload.series[1] && payload.series[1].name) || 'Series 2',
          opposite: true,
          decimalsInFloat: 0,
          min: 0,
          max: (function(){
            try {
              var s = payload.series && payload.series[1] && payload.series[1].data || [];
              var m = 0; for (var i=0;i<s.length;i++){ var v = Number(s[i]||0); if (v>m) m=v }
              if (m <= 0) return undefined; return Math.max(3, Math.ceil(m*1.4));
            } catch(e){ return undefined }
          })(),
          labels: { formatter: (v) => (typeof v === 'number' ? Math.round(v) : v), style: { colors: payload.label } },
        }
      ] : { labels: { formatter: (v) => typeof v === 'number' ? Math.round(v) : v } },
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: payload.type === 'area' ? [2.5, 1.5] : 2 },
      fill: payload.type === 'area'
        ? { type: 'gradient', opacity: [0.25, 0], gradient: { shadeIntensity: 1, opacityFrom: 0.25, opacityTo: 0.02, stops: [0, 100] } }
        : { opacity: 1 },
      plotOptions: { bar: { borderRadius: 6, horizontal: false } },
      tooltip: payload.aovTooltip ? {
        shared: true,
        intersect: false,
        theme: payload.mode,
        custom: function({ series, dataPointIndex, w }) {
          try {
            const label = (w?.globals?.labels?.[dataPointIndex]) ?? ''
            const s = Number(series?.[0]?.[dataPointIndex] ?? 0)
            const o = Number(series?.[1]?.[dataPointIndex] ?? 0)
            const aov = o > 0 ? (s / o) : 0
            const fmt = new Intl.NumberFormat('en-ET', { style: 'currency', currency: 'ETB', minimumFractionDigits: 0 })
            return '<div style="padding:8px;font-size:11px;">'
              + '<div style="font-weight:600;margin-bottom:4px;">' + label + '</div>'
              + '<div><span style="display:inline-block;width:10px;height:10px;background:'+payload.colors[0]+';border-radius:2px;margin-right:6px"></span>Sales: ' + fmt.format(s) + '</div>'
              + '<div><span style="display:inline-block;width:10px;height:10px;background:'+payload.colors[1]+';border-radius:2px;margin-right:6px"></span>Orders: ' + Math.round(o) + '</div>'
              + '<div style="margin-top:4px;color:'+payload.label+'">AOV: ' + fmt.format(aov) + ' / order</div>'
              + '</div>'
          } catch (e) {
            return ''
          }
        }
      } : { theme: payload.mode }
    };
    const chart = new ApexCharts(document.querySelector('#chart'), options);
    chart.render();
  </script>
</body>
</html>`
  }, [type, title, categories, series, height, maxTicks, aovTooltip, isDark])

  return (
    <View style={[styles.container, { height }, { borderColor: AdminColors.border, backgroundColor: AdminColors.card }]}> 
      <WebView originWhitelist={["*"]} source={{ html }} style={{ backgroundColor: 'transparent' }} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', borderRadius: 12, borderWidth: 1, borderColor: '#23262D' },
})
