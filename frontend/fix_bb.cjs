const fs = require('fs');

let clientJs = fs.readFileSync('src/modules/realtime/colyseus-babylon-client.js', 'utf8');

const normalizeScript = \
        // Normalize kart bounding box to prevent giant/tiny meshes
        let min = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
        let max = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);
        let validMeshes = 0;
        visualRoot.getChildMeshes().forEach(m => {
            m.computeWorldMatrix(true);
            const boundingInfo = m.getBoundingInfo();
            if(!boundingInfo) return;
            const { minimumWorld, maximumWorld } = boundingInfo.boundingBox;
            min = Vector3.Minimize(min, minimumWorld);
            max = Vector3.Maximize(max, maximumWorld);
            validMeshes++;
        });
        if (validMeshes > 0) {
            const extents = max.subtract(min);
            const maxDim = Math.max(extents.x, extents.y, extents.z) || 1;
            const uniformScale = (kartInfo.scale || 2.2) / maxDim;
            visualRoot.scaling = new Vector3(uniformScale, uniformScale, uniformScale);
        } else if (kartInfo.scale && kartInfo.scale !== 1) {
            visualRoot.scaling = new Vector3(kartInfo.scale, kartInfo.scale, kartInfo.scale);
        }
\;

const patchLocal = clientJs.replace(
    \        if (kartInfo.scale && kartInfo.scale !== 1) {
            visualRoot.scaling = new Vector3(kartInfo.scale, kartInfo.scale, kartInfo.scale);
        }\,
    normalizeScript
);

const normalizeScriptRemote = \
            // Normalize remote kart bounding box
            let min = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
            let max = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);
            let validMeshes = 0;
            realMesh.getChildMeshes().forEach(m => {
                m.computeWorldMatrix(true);
                const boundingInfo = m.getBoundingInfo();
                if(!boundingInfo) return;
                const { minimumWorld, maximumWorld } = boundingInfo.boundingBox;
                min = Vector3.Minimize(min, minimumWorld);
                max = Vector3.Maximize(max, maximumWorld);
                validMeshes++;
            });
            if (validMeshes > 0) {
                const extents = max.subtract(min);
                const maxDim = Math.max(extents.x, extents.y, extents.z) || 1;
                const uniformScale = (kartInfo.scale || 2.2) / maxDim;
                realMesh.scaling = new Vector3(uniformScale, uniformScale, uniformScale);
            } else if (kartInfo.scale && kartInfo.scale !== 1) {
                realMesh.scaling = new Vector3(kartInfo.scale, kartInfo.scale, kartInfo.scale);
            }
\;

const patchRemote = patchLocal.replace(
    \            if (kartInfo.scale && kartInfo.scale !== 1) {
                realMesh.scaling = new Vector3(kartInfo.scale, kartInfo.scale, kartInfo.scale);
            }\,
    normalizeScriptRemote
);

fs.writeFileSync('src/modules/realtime/colyseus-babylon-client.js', patchRemote, 'utf8');

console.log("Patched colyseus-babylon-client.js for bounding boxes");

