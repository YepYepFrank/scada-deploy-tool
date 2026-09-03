<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import L from 'leaflet'

const props = defineProps({
  lat: Number,
  lng: Number,
  heading: { type: Number, default: 0 },
})

const el = ref(null)
let map = null
let marker = null
let trail = null
const path = []

const icon = L.divIcon({
  className: '',
  html: `<div class="veh-ping">
    <span class="ring"></span><span class="ring r2"></span><span class="core"></span>
  </div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

onMounted(() => {
  map = L.map(el.value, { zoomControl: true, attributionControl: true })
  map.setView([props.lat || 22.53, props.lng || 114.05], 13)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map)
  trail = L.polyline([], { color: '#ffb454', weight: 2, opacity: 0.55 }).addTo(map)
  marker = L.marker([props.lat || 22.53, props.lng || 114.05], { icon }).addTo(map)
})

watch(
  () => [props.lat, props.lng],
  ([lat, lng]) => {
    if (!map || lat == null || lng == null) return
    marker.setLatLng([lat, lng])
    path.push([lat, lng])
    if (path.length > 400) path.shift()
    trail.setLatLngs(path)
    map.panTo([lat, lng], { animate: true, duration: 0.8 })
  },
)

onUnmounted(() => map && map.remove())
</script>

<template>
  <div ref="el" class="map-box"></div>
</template>
