/**
 * ThermaLink Routing Engine
 * 
 * Implements an A* pathfinding algorithm on a 2D coordinate grid representing Frankfurt.
 * Coordinates are mapped to real-world data center clusters (Sossenheim, Gallus, Fechenheim)
 * and municipal district heating nodes. Includes obstacles (e.g., the Main River).
 */

const RoutingEngine = {
    // Grid settings
    GRID_ROWS: 14,
    GRID_COLS: 16,
    CELL_SIZE_METERS: 200, // Each grid square is 200m x 200m
    PIPE_CAPEX_PER_METER: 2000, // €2,000 per meter in urban zones

    // Frankfurt data center nodes (Sources)
    sources: {
        SOSSENHEIM: { name: "Sossenheim Cluster (Equinix/DR)", x: 2, y: 2, capacityMw: 25, tempOut: 32 },
        GALLUS: { name: "Gallus Cluster (Telehouse)", x: 4, y: 8, capacityMw: 15, tempOut: 35 },
        FECHENHEIM: { name: "Fechenheim Cluster (Digital Realty)", x: 13, y: 4, capacityMw: 40, tempOut: 30 }
    },

    // Mainova District Heating nodes (Sinks/Junctions)
    sinks: {
        JUNCTION_NORTH: { name: "Mainova North Loop Junction", x: 6, y: 3, tempReq: 75 },
        JUNCTION_WEST: { name: "Mainova West Feed Loop", x: 4, y: 5, tempReq: 80 },
        JUNCTION_CITY: { name: "City Main loop Feed", x: 8, y: 9, tempReq: 85 },
        JUNCTION_EAST: { name: "Fechenheim Industrial Loop", x: 11, y: 5, tempReq: 70 }
    },

    // Grid obstacles where pipe installation is blocked (e.g., Main River, railway barriers)
    // Represented as 'y,x' coordinate string sets
    obstacles: new Set([
        "6,0", "6,1", "6,2", "6,3", "6,4", "7,4", "7,5", "7,6", "7,7", "8,7", "8,8", "8,9", "8,10", "8,11", "9,11", "9,12", "9,13", "9,14", "9,15", // The Main River running across
        "1,7", "2,7", "3,7", "4,7", "5,7" // Central rail trunk barrier
    ]),

    isObstacle(x, y) {
        return this.obstacles.has(`${y},${x}`);
    },

    /**
     * A* Pathfinding implementation.
     * Finds the shortest path avoiding river/rail obstacles.
     * 
     * @param {number} startX 
     * @param {number} startY 
     * @param {number} endX 
     * @param {number} endY 
     * @returns {Array} List of grid points [{x, y}] or empty if no path
     */
    findPath(startX, startY, endX, endY) {
        const startNode = { x: startX, y: startY, g: 0, h: this.heuristic(startX, startY, endX, endY), parent: null };
        const openSet = [startNode];
        const closedSet = new Set();

        const nodeKey = (x, y) => `${x},${y}`;

        while (openSet.length > 0) {
            // Get node with lowest f value
            openSet.sort((a, b) => (a.g + a.h) - (b.g + b.h));
            const current = openSet.shift();

            if (current.x === endX && current.y === endY) {
                // Reconstruct path
                const path = [];
                let temp = current;
                while (temp !== null) {
                    path.push({ x: temp.x, y: temp.y });
                    temp = temp.parent;
                }
                return path.reverse();
            }

            closedSet.add(nodeKey(current.x, current.y));

            // Explore 4 orthogonal neighbors
            const neighbors = [
                { x: current.x + 1, y: current.y },
                { x: current.x - 1, y: current.y },
                { x: current.x, y: current.y + 1 },
                { x: current.x, y: current.y - 1 }
            ];

            for (const n of neighbors) {
                if (n.x < 0 || n.x >= this.GRID_COLS || n.y < 0 || n.y >= this.GRID_ROWS) continue;
                if (this.isObstacle(n.x, n.y)) continue;
                if (closedSet.has(nodeKey(n.x, n.y))) continue;

                // Manhattan movement cost is 1 grid unit
                const tentativeG = current.g + 1;

                let existing = openSet.find(item => item.x === n.x && item.y === n.y);

                if (!existing) {
                    const neighborNode = {
                        x: n.x,
                        y: n.y,
                        g: tentativeG,
                        h: this.heuristic(n.x, n.y, endX, endY),
                        parent: current
                    };
                    openSet.push(neighborNode);
                } else if (tentativeG < existing.g) {
                    existing.g = tentativeG;
                    existing.parent = current;
                }
            }
        }

        return []; // No path found
    },

    heuristic(x1, y1, x2, y2) {
        // Manhattan distance heuristic
        return Math.abs(x1 - x2) + Math.abs(y1 - y2);
    },

    /**
     * Calculates cost and metrics for a route path.
     * 
     * @param {Array} path - [{x, y}] path array
     * @returns {Object} Route metrics (meters, CAPEX)
     */
    calculateRouteMetrics(path) {
        if (path.length === 0) {
            return {
                lengthMeters: 0,
                capexEuro: 0
            };
        }

        // Distance in cells is path node count - 1
        const cells = path.length - 1;
        const lengthMeters = cells * this.CELL_SIZE_METERS;
        const capexEuro = lengthMeters * this.PIPE_CAPEX_PER_METER;

        return {
            lengthMeters,
            capexEuro
        };
    }
};

// Export for Node testing or attach to window
if (typeof module !== "undefined" && module.exports) {
    module.exports = RoutingEngine;
} else {
    window.RoutingEngine = RoutingEngine;
}
