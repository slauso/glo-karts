const fs = require('fs'); let b = fs.readFileSync('C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js', 'utf8'); b = b.replace(/if \\(kartInfo.scale && kartInfo.scale !== 1\\) \\{\\s*this.localMesh.scaling = new Vector3\\(kartInfo.scale, kartInfo.scale, kartInfo.scale\\);\\s*\\}/, \        // Normalize local bounding
        let min1 = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
        let max1 = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);
        this.localMesh.getChildMeshes().forEach(m => {
            m.computeWorldMatrix(true);
            const bInfo = m.getBoundingInfo();
            if(!bInfo) return;
            min1 = Vector3.Minimize(min1, bInfo.boundingBox.minimumWorld);
            max1 = Vector3.Maximize(max1, bInfo.boundingBox.maximumWorld);
        });
        const extents1 = max1.subtract(min1);
        const maxDim1 = Math.max(extents1.x, extents1.y, extents1.z) || 1;
        const uniformScale1 = (kartInfo.scale || 2.2) / maxDim1;
        this.localMesh.scaling = new Vector3(uniformScale1, uniformScale1, uniformScale1);
        
        // REFRESH BOUNDS FOR PHYSICS
        this.localMesh.getChildMeshes().forEach(m => m.computeWorldMatrix(true));
        this.localMesh.refreshBoundingInfo(true, true);\); fs.writeFileSync('C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js', b);
