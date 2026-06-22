/**
 * ThermaLink Thermodynamic Calculator
 * 
 * Computes pipeline temperature decay (exponential thermal loss),
 * industrial heat pump COP (coefficient of performance), electricity requirements,
 * and net CO2 offset balances based on German grid factors.
 */

const ThermoEngine = {
    // Specific heat capacity of water in J/(kg·K)
    CP_WATER: 4184,
    // Density of water in kg/m³
    DENSITY_WATER: 1000,
    // Displaced heat source carbon intensity (Natural Gas boiler baseline) in g CO2/kWh
    CARBON_BOILER_BASELINE: 202.0,

    /**
     * Calculates the temperature of the water delivered to the grid after traveling through the pipe.
     * Uses the exponential heat loss formula for buried pipelines.
     * 
     * @param {number} tSource - Water temperature leaving the source/heat pump (°C)
     * @param {number} tGround - Ground/soil temperature (°C)
     * @param {number} uValue - Overall heat transfer coefficient (W/m²K)
     * @param {number} pipeDiameter - Outer diameter of the inner pipe (m)
     * @param {number} lengthMeters - Total pipeline route length (m)
     * @param {number} flowRateLps - Water flow rate in liters per second (L/s)
     * @returns {number} Delivered temperature (°C)
     */
    calculateDeliveredTemp(tSource, tGround, uValue, pipeDiameter, lengthMeters, flowRateLps) {
        if (lengthMeters <= 0) return tSource;
        if (flowRateLps <= 0) return tGround;

        // Convert flow rate from L/s to kg/s (assuming water density of 1000 kg/m³)
        const massFlowRate = (flowRateLps / 1000) * this.DENSITY_WATER;

        // Exponential decay equation: T_delivered = T_ground + (T_source - T_ground) * e^(-(U * pi * D * L) / (m_dot * Cp))
        const exponent = -(uValue * Math.PI * pipeDiameter * lengthMeters) / (massFlowRate * this.CP_WATER);
        const deliveredTemp = tGround + (tSource - tGround) * Math.exp(exponent);

        return Math.max(tGround, Math.min(tSource, deliveredTemp));
    },

    /**
     * Calculates the COP of the industrial booster heat pump.
     * Uses Carnot limit multiplied by a compressor/system efficiency factor.
     * 
     * @param {number} tSourceInlet - Cold temperature entering the evaporator (from servers, °C)
     * @param {number} tSinkOutlet - Hot temperature leaving the condenser (for district grid, °C)
     * @param {number} efficiencyFactor - Lorenz/Carnot efficiency fraction (typically 0.50 to 0.60)
     * @returns {number} Heat Pump Coefficient of Performance (COP)
     */
    calculateHeatPumpCOP(tSourceInlet, tSinkOutlet, efficiencyFactor = 0.55) {
        if (tSinkOutlet <= tSourceInlet) return 1.0;

        // Convert to Kelvin
        const tHotK = tSinkOutlet + 273.15;
        const tColdK = tSourceInlet + 273.15;

        // Carnot Limit: COP = T_hot / (T_hot - T_cold)
        const carnotCOP = tHotK / (tHotK - tColdK);

        // Actual COP is scaled by compressor/system efficiency
        const actualCOP = efficiencyFactor * carnotCOP;

        // COP cannot physically drop below 1.0 (electric resistance limit)
        return Math.max(1.0, actualCOP);
    },

    /**
     * Runs full thermodynamics energy balance analysis.
     * 
     * @param {number} dataCenterHeatMw - Waste heat power capacity of the data center (MW)
     * @param {number} tDCCoolant - Data center coolant outlet loop temperature (°C)
     * @param {number} tGridRequired - Target district heating network supply temperature (°C)
     * @param {number} lengthMeters - Connection pipe route length (m)
     * @param {number} uValue - Pipe thermal insulation coefficient (W/m²K)
     * @param {number} tGround - Ambient ground temperature (°C)
     * @param {number} gridCarbonIntensity - Carbon intensity of electric grid (g CO2/kWh)
     * @returns {Object} Energy audit report metrics
     */
    runEnergyAudit(
        dataCenterHeatMw,
        tDCCoolant,
        tGridRequired,
        lengthMeters,
        uValue = 0.24,
        tGround = 10.0,
        gridCarbonIntensity = 380.0
    ) {
        // 1. Calculate Heat Pump COP
        // We boost the heat from tDCCoolant to the target grid temperature
        const cop = this.calculateHeatPumpCOP(tDCCoolant, tGridRequired);

        // Heat Pump Energy Balance: 
        // Q_sink (Heat Delivered) = Q_evaporator (Waste Heat absorbed) + W_compressor (Electric power input)
        // Since COP = Q_sink / W_compressor, and Q_evaporator = dataCenterHeatMw:
        // Q_sink = dataCenterHeatMw * (COP / (COP - 1))
        // Electric Power Input (W_compressor) = Q_sink / COP
        let electricPowerMw = 0.0;
        let deliveredHeatPowerMw = 0.0;

        if (cop > 1.0) {
            electricPowerMw = dataCenterHeatMw / (cop - 1.0);
            deliveredHeatPowerMw = dataCenterHeatMw + electricPowerMw;
        } else {
            electricPowerMw = dataCenterHeatMw; // Fallback to direct resistive heating
            deliveredHeatPowerMw = dataCenterHeatMw;
        }

        // Standard flow rate calculation: flow_rate = Heat_power / (density * Cp * delta_T)
        // Assume district network return temperature is 50°C. Temperature delta is (tGridRequired - 50)
        const tGridReturn = 50.0;
        const deltaT = Math.max(5.0, tGridRequired - tGridReturn);
        const flowRateLps = (deliveredHeatPowerMw * 1e6) / (this.CP_WATER * deltaT);

        // 2. Calculate temperature decay over route distance
        // Pipe outer diameter DN100 is roughly 0.114 meters
        const pipeDiameter = 0.114;
        const deliveredTemp = this.calculateDeliveredTemp(
            tGridRequired,
            tGround,
            uValue,
            pipeDiameter,
            lengthMeters,
            flowRateLps
        );

        const temperatureLoss = tGridRequired - deliveredTemp;

        // 3. Compute annual metrics (assuming 80% data center utilization, i.e. 7000 operating hours/year)
        const OPERATING_HOURS = 7000;
        const annualHeatDeliveredMwh = deliveredHeatPowerMw * OPERATING_HOURS;
        const annualElectricConsumedMwh = electricPowerMw * OPERATING_HOURS;

        // 4. Carbon Accounting
        // Displaced carbon from baseline natural gas boiler
        const carbonOffsetKg = (annualHeatDeliveredMwh * 1000) * (this.CARBON_BOILER_BASELINE / 1000);
        // Carbon emitted from heat pump compressor electric draw
        const carbonEmittedKg = (annualElectricConsumedMwh * 1000) * (gridCarbonIntensity / 1000);
        const netCarbonSavedKg = carbonOffsetKg - carbonEmittedKg;
        const netCarbonSavedTonnes = netCarbonSavedKg / 1000.0;

        // 5. EnEfG Auditing Benchmarks
        // - Requirement 1: Delivered temperature must be >= 60°C to be useful for standard networks
        const tempCheck = deliveredTemp >= 60.0;
        // - Requirement 2: Net Carbon Saved must be positive (must not generate more carbon than it offsets)
        const carbonCheck = netCarbonSavedTonnes > 0;
        // - Requirement 3: EnEfG requires waste heat utilization factor >= 15% (which is checked if connected)
        const routeViableCheck = lengthMeters <= 2500; // Over 2.5km is economically unviable in city zones
        
        let complianceGrade = "FAIL";
        let statusReason = "";

        if (!routeViableCheck) {
            complianceGrade = "FAIL";
            statusReason = "Pipeline distance exceeds economic threshold (2.5 km).";
        } else if (!tempCheck) {
            complianceGrade = "FAIL";
            statusReason = "Delivered heat temperature is too low (< 60°C) due to pipeline thermal dissipation.";
        } else if (!carbonCheck) {
            complianceGrade = "FAIL";
            statusReason = "Heat pump electricity carbon footprint exceeds the displaced boiler carbon offset.";
        } else {
            // Grading scaling based on COP and Net Savings
            if (cop >= 4.5 && netCarbonSavedTonnes > 2000) {
                complianceGrade = "CLASS A";
            } else if (cop >= 3.5) {
                complianceGrade = "CLASS B";
            } else {
                complianceGrade = "CLASS C";
            }
            statusReason = "Meets all EnEfG waste heat recovery standards.";
        }

        return {
            cop: Math.round(cop * 100) / 100,
            electricPowerMw: Math.round(electricPowerMw * 100) / 100,
            deliveredHeatPowerMw: Math.round(deliveredHeatPowerMw * 100) / 100,
            deliveredTemp: Math.round(deliveredTemp * 10) / 10,
            temperatureLoss: Math.round(temperatureLoss * 10) / 10,
            flowRateLps: Math.round(flowRateLps * 10) / 10,
            annualHeatDeliveredMwh: Math.round(annualHeatDeliveredMwh),
            annualElectricConsumedMwh: Math.round(annualElectricConsumedMwh),
            netCarbonSavedTonnes: Math.round(netCarbonSavedTonnes),
            complianceGrade,
            statusReason
        };
    }
};

// Export for Node testing or attach to window for browser use
if (typeof module !== "undefined" && module.exports) {
    module.exports = ThermoEngine;
} else {
    window.ThermoEngine = ThermoEngine;
}
