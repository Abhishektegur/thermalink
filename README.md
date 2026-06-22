# ThermaLink ⚡

This is an interactive **waste heat routing and zoning simulator** built as a companion digital twin for my Master's Thesis on data center heat recovery in Germany. 

The tool models the physical and economic feasibility of connecting data center waste heat sources (like loops in Sossenheim or Gallus) to municipal district heating networks (Mainova) to audit their compliance with the German **Energy Efficiency Act (EnEfG)**.

---

## Live Demo
The interactive dashboard is hosted live on GitHub Pages:
👉 **[abhishektegur.github.io/thermalink/thermalink/](https://abhishektegur.github.io/thermalink/thermalink/)**

---

## System Architecture

```
        +-----------------------------------------------------+
        |                 Interactive Web UI                  |
        |  (Collapsible Parameters, PowerBI Scorecard Gauges) |
        +-----------------------------------------------------+
                                   |
                                   v
        +-----------------------------------------------------+
        |            3D Isometric Grid Canvas                 |
        |  (Renders Data Centers, Sinks, & Routed Pipelines)  |
        +-----------------------------------------------------+
                                   |
                                   v
        +-----------------------------------------------------+
        |                   Routing Engine                    |
        |        (A* Pathfinding on municipal grids)          |
        +-----------------------------------------------------+
                                   |
                                   v
        +-----------------------------------------------------+
        |               Thermodynamic Engine                  |
        |  (Buried pipe decay, Carnot limits, Net Carbon)     |
        +-----------------------------------------------------+
```

---

## Core Calculations

### 1. Thermal Loss Over Distance ($T_{\text{delivered}}$)
High-temperature water cools down as it travels through pipes buried in the soil. ThermaLink models this exponential thermal decay:

$$T_{\text{delivered}} = T_{\text{ground}} + (T_{\text{source}} - T_{\text{ground}}) \times e^{-\frac{U \cdot \pi \cdot D \cdot L}{\dot{m} \cdot C_p}}$$

Where:
* $T_{\text{ground}}$ = Soil temperature (°C)
* $U$ = Heat loss coefficient (W/m²K)
* $D$ = Pipe diameter (m)
* $L$ = Total pipeline route length (m)
* $\dot{m}$ = Mass water flow rate (kg/s)
* $C_p$ = Specific heat capacity of water ($4184\text{ J/kgK}$)

### 2. Heat Pump Carnot COP Limit
The electrical efficiency of the booster heat pumps is modeled using the Carnot limit scaled by a system compressor efficiency factor (defaulting to 55%):

$$\text{COP}_{\text{actual}} = 0.55 \times \frac{T_{\text{sink}} + 273.15}{T_{\text{sink}} - T_{\text{source}}}$$

---

## Local Setup & Deployment

### 1. Local Preview
Since ThermaLink has zero backend dependencies and runs entirely client-side, you don't need a server to run it. 

Simply open the `index.html` file in any modern web browser to view the interface!

### 2. Deploy to GitHub Pages
To make the dashboard live on your public GitHub profile:
1. Initialize Git in the project folder and push it to a new public repository named **`thermalink`** on your GitHub account.
2. Go to the repository settings on the GitHub website.
3. In the left sidebar, click **Pages**.
4. Under **Build and deployment**, set the Source to **Deploy from a branch**.
5. Select the **`main`** branch and the **`/ (root)`** folder, and click **Save**.
6. Within a minute, your live 3D dashboard will be published and viewable at `https://Abhishektegur.github.io/thermalink/`.
