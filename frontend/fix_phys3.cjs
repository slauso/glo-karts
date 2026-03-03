const fs = require('fs'); let b = fs.readFileSync('C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js', 'utf8'); b = b.replace(/if \\(kartInfo.scale && kartInfo.scale !== 1\\) \\{\\s*realMesh.scaling = new Vector3\\(kartInfo.scale, kartInfo.scale, kartInfo.scale\\);\\s*\\}/, \            let min2 = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
            let max2 = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);
            realMesh.getChildMeshes().forEach(m => {
                m.computeWorldMatrix(true);
                const bInfo = m.getBoundingInfo();
                if(!bInfo) return;
                min2 = Vector3.Minimize(min2, bInfo.boundingBox.minimumWorld);
                max2 = Vector3.Maximize(max2, bInfo.boundingBox.maximumWorld);
            });
            const extents2 = max2.subtract(min2);
            const maxDim2 = Math.max(extents2.x, extents2.y, extents2.z) || 1;
            const uniformScale2 = (kartInfo.scale || 2.2) / maxDim2;
            realMesh.scaling = new Vector3(uniformScale2, uniformScale2, uniformScale2);
            realMesh.getChildMeshes().forEach(m => m.computeWorldMatrix(true));
            realMesh.refreshBoundingInfo(true, true);\); fs.writeFileSync('C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js', b);
