const fs = require('fs');
let b = fs.readFileSync('C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js', 'utf8');

const r1 = `        // Dynamic physics extents calculation
        let extents1 = new Vector3(1,1,1);
        let min1 = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
        let max1 = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);
        let validMeshes1 = 0;
        this.localMesh.getChildMeshes().forEach(m => {
            m.computeWorldMatrix(true);
            const bInfo = m.getBoundingInfo();
            if(!bInfo) return;
            min1 = Vector3.Minimize(min1, bInfo.boundingBox.minimumWorld);
            max1 = Vector3.Maximize(max1, bInfo.boundingBox.maximumWorld);
            validMeshes1++;
        });

        if (validMeshes1 > 0) {
            const rawExtents = max1.subtract(min1);
            const maxDim = Math.max(rawExtents.x, rawExtents.y, rawExtents.z) || 1;
            const uniformScale = (kartInfo.scale || 2.2) / maxDim;
            this.localMesh.scaling = new Vector3(uniformScale, uniformScale, uniformScale);
            this.localMesh.computeWorldMatrix(true);
            extents1 = rawExtents.scale(uniformScale);
        } else if (kartInfo.scale && kartInfo.scale !== 1) {
            this.localMesh.scaling = new Vector3(kartInfo.scale, kartInfo.scale, kartInfo.scale);
            this.localMesh.computeWorldMatrix(true);
            extents1 = new Vector3(1.8, 1.8, 1.8).scale(kartInfo.scale);
        }

        this.localKartAggregate = new PhysicsAggregate(this.localMesh, PhysicsShapeType.BOX, { mass: 800, friction: 0.8, restitution: 0.1, extents: extents1 }, this.scene);`;

b = b.replace(/if \(\s*kartInfo\.scale && kartInfo\.scale !== 1\s*\) \{(?:[^}]*)\}\s*this\.localKartAggregate = new PhysicsAggregate\(this\.localMesh, PhysicsShapeType\.BOX, \{ mass: 800, friction: 0\.8, restitution: 0\.1 \}, this\.scene\);/, r1);

const r2 = `            let min2 = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
            let max2 = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);
            let validMeshes2 = 0;
            realMesh.getChildMeshes().forEach(m => {
                m.computeWorldMatrix(true);
                const bInfo = m.getBoundingInfo();
                if(!bInfo) return;
                min2 = Vector3.Minimize(min2, bInfo.boundingBox.minimumWorld);
                max2 = Vector3.Maximize(max2, bInfo.boundingBox.maximumWorld);
                validMeshes2++;
            });
            if (validMeshes2 > 0) {
                const extents2 = max2.subtract(min2);
                const maxDim2 = Math.max(extents2.x, extents2.y, extents2.z) || 1;
                const uniformScale2 = (kartInfo.scale || 2.2) / maxDim2;
                realMesh.scaling = new Vector3(uniformScale2, uniformScale2, uniformScale2);
                realMesh.computeWorldMatrix(true);
            } else if (kartInfo.scale && kartInfo.scale !== 1) {
                realMesh.scaling = new Vector3(kartInfo.scale, kartInfo.scale, kartInfo.scale);
            }`;

b = b.replace(/if \(\s*kartInfo\.scale && kartInfo\.scale !== 1\s*\) \{[^}]*\}/g, r2);

fs.writeFileSync('C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js', b);
console.log("Done");