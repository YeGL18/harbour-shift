// MapLibre RN 11.5.1 Android receives repeated style setters from Fabric.
// Keep identical, already requested styles from clearing all child layers.
// This patch is intentionally narrow and fails if upstream changes its anchors.
const fs = require('node:fs');
const path = require('node:path');
const target = path.join(__dirname, '../node_modules/@maplibre/maplibre-react-native/android/src/main/java/org/maplibre/reactnative/components/mapview/MLRNMapView.kt');
let source = fs.readFileSync(target, 'utf8');
if (source.includes('HARBOUR_IDEMPOTENT_STYLE')) process.exit(0);
const replacements = [
  ['    private var mapStyle: String? = null', '    private var mapStyle: String? = null\n    // HARBOUR_IDEMPOTENT_STYLE: do not reload an identical requested style.\n    private var requestedMapStyle: String? = null\n    private var loggedDuplicateStyle = false'],
  ['    override fun onDestroy() {\n        super.onDestroy()', '    override fun onDestroy() {\n        requestedMapStyle = null\n        super.onDestroy()'],
  ['        mapStyle?.let { style ->\n            mapLibreMap.setStyle(', '        mapStyle?.let { style ->\n            requestedMapStyle = style\n            mapLibreMap.setStyle('],
  ['    override fun onDidFailLoadingMap(errorMessage: String?) {\n        handleMapChangedEvent', '    override fun onDidFailLoadingMap(errorMessage: String?) {\n        requestedMapStyle = null\n        handleMapChangedEvent'],
  ['    fun setReactMapStyle(value: String?) {\n        if (value != null) {\n            mapStyle = value', '    fun setReactMapStyle(value: String?) {\n        if (value != null) {\n            if (value == requestedMapStyle && mapLibreMap != null) {\n                if (!loggedDuplicateStyle) {\n                    android.util.Log.d("HarbourMapStyle", "Ignored duplicate requested style from Fabric")\n                    loggedDuplicateStyle = true\n                }\n                return\n            }\n            mapStyle = value'],
  ['            mapLibreMap?.let { map ->\n                removeAllSourcesFromMap()', '            mapLibreMap?.let { map ->\n                requestedMapStyle = value\n                removeAllSourcesFromMap()'],
];
for (const [before, after] of replacements) {
  if (!source.includes(before)) throw new Error('MapLibre Android patch anchor missing: ' + before);
  source = source.replace(before, after);
}
fs.writeFileSync(target, source);
process.stdout.write('Applied MapLibre Android idempotent style patch.\n');
