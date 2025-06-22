//-------------------------------------------------------------
// OtmSumChart.js 
//-------------------------------------------------------------
import React from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";

export default function OtmSumChart({ average, realtime, currentPoint }) {
  const options = {
    chart : { type:"line", height:420, backgroundColor:"#1d1d27" },
    title : { text:null },
    xAxis : {
      title:{ text:"剩餘可交易分鐘", style:{color:"#ccc"} },
      labels:{ style:{color:"#ccc"} },
      reversed:true
    },
    yAxis : {
      title:{ text:"OTM 時間價值 (點)", style:{color:"#ccc"} },
      labels:{ style:{color:"#ccc"} }
    },
    tooltip:{
      shared:true,
      backgroundColor:"#1d1d27",
      style:{ color:"#eee" }
    },
    legend:{ itemStyle:{ color:"#ccc" } },
    series:[
      { name:average.name,  data:average.data,  color:"#ffe14d", lineWidth:2.5 },
      { name:realtime.name, data:realtime.data, color:"#ff4d4f", lineWidth:2.5 },
      {
        name:"最新值",
        type:"scatter",
        color:"#1ad1ff",
        marker:{ radius:6, symbol:"circle" },
        data:[currentPoint],
        tooltip:{ pointFormat:"<b>{point.y}</b>" }
      }
    ],
    credits:{ enabled:false }
  };
  return <HighchartsReact highcharts={Highcharts} options={options}/>;
}
