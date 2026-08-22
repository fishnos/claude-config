---
name: robotics-development
description: Use when developing robotics software, writing robot control logic, testing robot behavior, or working with ROS2, embedded microcontrollers, or Python simulation environments.
user-invocable: true
paths: "**/*.urdf,**/*.xacro,**/*.sdf,**/*.world,**/package.xml,**/launch/**,**/*.msg,**/*.srv,**/*.action"
---

# Robotics Development: Testing & Simulation

## Overview

Test robotics software in simulation before hardware. Isolate logic from hardware dependencies. Inject realistic noise. Address robotics-specific failure modes that general software testing misses.

## Context Detection — Platform-Specific Workflows

**Read the conversation context and apply the matching section below.**

| If the conversation mentions...                          | Apply workflow                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| ROS, ROS2, nodes, topics, services, rosbag, launch files | [ROS2 Workflow](#ros2-workflow) — emphasize this                 |
| Arduino, ESP32, AVR, PlatformIO, embedded C/C++          | [Embedded Workflow](#embedded-workflow)                          |
| PyBullet, Gazebo, Isaac Sim, nav2, Python robot code     | [Python Robotics Workflow](#python-robotics-workflow)            |
| Multiple platforms in one conversation                   | Apply all relevant sections; share cross-platform patterns first |

## Core Principles (All Platforms)

### Simulation-First

1. Test in simulation until behavior is correct.
2. Introduce noise and fault conditions.
3. Then test on hardware.

Never validate control logic on real hardware before simulated correctness is established. Hardware bugs are expensive; simulation bugs are free.

### Hardware Abstraction Layer (HAL)

Separate control logic from hardware calls at a clear interface. This is the single most important testability decision in any robotics project.

```cpp
// ❌ Not testable
void update() {
    float angle = analogRead(A0) * (180.0 / 1023.0);
    servo.write(pid.compute(angle));
}

// ✅ Testable
class HardwareInterface {
public:
    virtual float readSensorAngle() = 0;
    virtual void writeActuator(float value) = 0;
};

class Controller {
    HardwareInterface& hw;
    float update() { return pid.compute(hw.readSensorAngle()); }
};
```

### Realistic Synthetic Data

Never test with only clean/ideal inputs. Add:

- **Sensor noise:** Gaussian noise at realistic σ values
- **Dropped messages:** Random message loss (5–10%)
- **Out-of-order messages:** Replay with jittered timestamps
- **Edge cases:** `inf`, `NaN`, max/min range values, empty scans
- **Fault injection:** Sensor dropout, motor stall, communication loss mid-operation

### Property-Based Testing

Apply across all platforms — not just Python:

```python
from hypothesis import given, strategies as st

@given(ranges=st.lists(st.floats(0.1, 10.0) | st.just(float('inf')), min_size=1))
def test_obstacle_detector_never_crashes(ranges):
    # Must never raise — only return valid output or None
    result = detect_obstacles(ranges)
    assert result is None or isinstance(result, list)
```

---

## ROS2 Workflow

> **Emphasize this section when ROS/ROS2 is mentioned.**

### Unit Testing Nodes

Use `pytest` with `rclpy`. Call callbacks directly — do not spin the full node graph for unit tests.

```python
import pytest, rclpy
from sensor_msgs.msg import LaserScan
from your_pkg.lidar_processor import LidarProcessorNode

@pytest.fixture(scope='module')
def ros():
    rclpy.init(); yield; rclpy.shutdown()

def test_ignores_nan_ranges(ros):
    node = LidarProcessorNode()
    scan = LaserScan()
    scan.ranges = [float('nan')] * 360
    node.lidar_callback(scan)  # Must not raise or publish garbage
    # Assert node published nothing or a safe empty result
```

### Topic / Service Mocking

Create minimal mock publishers/subscribers in the test — don't rely on real hardware or a running robot.

```python
def test_processes_obstacle_scan(ros):
    node = LidarProcessorNode()
    received = []
    sub = node.create_subscription(ObstacleArray, '/obstacles',
                                   lambda msg: received.append(msg), 10)
    scan = make_scan_with_obstacle_at(distance=1.5, angle=0.0)
    node.lidar_callback(scan)
    rclpy.spin_once(node, timeout_sec=0.1)
    assert len(received) == 1
    assert abs(received[0].obstacles[0].distance - 1.5) < 0.01
```

### tf / tf2 Testing (Critical — Commonly Broken)

Frame transform bugs are silent and dangerous. Always test explicitly.

```python
def test_output_in_correct_frame(ros):
    node = LidarProcessorNode()
    scan = make_test_scan()
    scan.header.frame_id = 'lidar_link'
    node.lidar_callback(scan)
    # Assert output is published in the expected world frame, not lidar_link
    assert received_obstacle.header.frame_id == 'base_link'
```

Rules:

- Assert `frame_id` on every published message in tests.
- Test transforms at non-trivial robot poses (not just identity).
- Test with a static TF broadcaster in the test fixture — don't assume TF is available.

### QoS Compatibility Testing

Mismatched QoS policies cause silent communication failures. Test explicitly:

```python
def test_subscribes_with_sensor_qos(ros):
    # Verify your node's subscription QoS matches the sensor driver's publisher QoS
    node = LidarProcessorNode()
    pub_qos = QoSProfile(reliability=BEST_EFFORT, durability=VOLATILE)
    pub = node.create_publisher(LaserScan, '/scan', pub_qos)
    # Message must be received — QoS mismatch = silent failure
```

### rosbag Regression Testing

Record a bag file once (from simulation or real hardware). Replay it in CI as a regression test.

```bash
ros2 bag record /scan /tf /odom -o fixtures/nominal_run
# In CI:
ros2 bag play fixtures/nominal_run &
pytest tests/integration/
```

### Launch File Integration Tests

Use `launch_testing` to test the full node graph starts, subscribes, and publishes within expected deadlines.

```python
from launch_testing.actions import ReadyToTest
# Assert: node starts, publishes on /obstacles within 2s of receiving /scan
```

### Timing & Latency Assertions

```python
def test_processing_latency(ros):
    t0 = time.monotonic()
    node.lidar_callback(make_test_scan())
    latency = time.monotonic() - t0
    assert latency < 0.010  # Must complete within 10ms for 100Hz loop
```

---

## Embedded Workflow

### Off-Target Testing (Host Machine)

Never test control logic only on the microcontroller. Compile and test on the host with Google Test or Unity.

**PlatformIO native environment:**

```ini
[env:native]
platform = native
build_flags = -std=c++17
test_framework = googletest
```

Run with: `pio test -e native`

### Mock the HAL

```cpp
class MockHardware : public HardwareInterface {
public:
    float angle_to_return = 90.0f;
    float last_written_value = 0.0f;
    float readSensorAngle() override { return angle_to_return; }
    void writeActuator(float v) override { last_written_value = v; }
};

TEST(Controller, DrivesTowardSetpoint) {
    MockHardware hw;
    hw.angle_to_return = 45.0f;
    Controller ctrl(hw, /*setpoint=*/90.0f);
    ctrl.update();
    EXPECT_GT(hw.last_written_value, 0.0f);
}
```

### Safety Limit Testing (Never Skip)

```cpp
TEST(Controller, NeverExceedsJointLimits) {
    MockHardware hw;
    Controller ctrl(hw, /*setpoint=*/999.0f); // Extreme input
    ctrl.update();
    EXPECT_LE(hw.last_written_value, MAX_ACTUATOR_VALUE);
}

TEST(Controller, EmergencyStopHaltsOutput) {
    Controller ctrl(hw, 90.0f);
    ctrl.triggerEStop();
    ctrl.update();
    EXPECT_EQ(hw.last_written_value, 0.0f);
}
```

### Memory & Timing Concerns

- Test for integer overflow in fixed-point math explicitly.
- Assert interrupt handlers complete within their deadline (measure with a logic analyzer or timer mock).
- No heap allocation in ISRs or control loops — test with a static analysis rule.
- Test communication parsing with malformed/truncated inputs.

---

## Python Robotics Workflow

### Unit Test Logic in Isolation

Navigation, planning, and perception algorithms are pure functions — test them without simulation overhead.

```python
def test_planner_finds_path_around_wall():
    grid = np.zeros((100, 100), dtype=np.uint8)
    grid[40:60, 50] = 1  # Vertical wall
    path = plan(start=(10, 50), goal=(80, 50), grid=grid)
    assert path is not None
    assert all(grid[r, c] == 0 for r, c in path)

def test_planner_returns_none_when_blocked():
    grid = np.zeros((100, 100), dtype=np.uint8)
    grid[:, 50] = 1  # Impassable wall
    assert plan(start=(10, 10), goal=(80, 80), grid=grid) is None
```

### Simulation Environments

| Use case                 | Tool                                          |
| ------------------------ | --------------------------------------------- |
| 3D physics, manipulation | PyBullet (lightweight) or Isaac Sim           |
| Full ROS2 integration    | Gazebo                                        |
| Navigation / 2D          | Custom kinematic sim or Gymnasium environment |
| RL training              | Gymnasium/Isaac Lab                           |

### Kinematic Simulation for Integration Tests

```python
def test_navigation_reaches_goal():
    sim = DifferentialDriveSimulator(map='test_map.yaml')
    nav = NavigationStack(sim.get_odom, sim.get_scan)
    sim.set_pose(0.0, 0.0, 0.0)
    nav.set_goal(5.0, 5.0)
    for _ in range(2000):
        cmd = nav.compute_velocity()
        sim.step(cmd)
        if nav.goal_reached(): break
    assert nav.goal_reached(), "Did not reach goal within step budget"
```

### Noise Injection

```python
def make_noisy_scan(clean_ranges, noise_std=0.02, dropout_rate=0.05):
    noisy = clean_ranges + np.random.normal(0, noise_std, len(clean_ranges))
    mask = np.random.random(len(clean_ranges)) < dropout_rate
    noisy[mask] = float('inf')  # Simulates dropout
    return noisy
```

### Performance Assertion

```python
def test_planning_meets_deadline():
    start = time.perf_counter()
    plan(start=(0, 0), goal=(99, 99), grid=large_grid)
    assert time.perf_counter() - start < 0.05  # Must fit in 20Hz control loop
```

---

## Hardware-in-the-Loop (HIL)

Graduate to HIL when:

- Simulation passes with noise injection
- Timing behavior cannot be simulated accurately
- Safety-critical interrupt or watchdog logic must be verified on real hardware

HIL architecture:

```
[PC: physics sim / fault injector] <-- serial/CAN/Ethernet --> [Real MCU/Robot]
```

- The PC simulates the environment and injects faults.
- The real hardware runs actual firmware.
- Assert on both hardware outputs and PC-side measurements.

**Do not go to full hardware deployment until HIL passes.** HIL catches the sim-to-real gap without physical risk.

---

## Simulation Fidelity Gap

Simulation cannot catch everything. After simulation and HIL, validate on hardware for:

- Contact dynamics and friction (PyBullet approximates; real physics differs)
- Sensor noise characteristics (real sensors are non-Gaussian)
- Electromagnetic interference affecting sensors
- Thermal effects on motor performance
- Mechanical backlash and compliance

Structure hardware commissioning tests to cover exactly these gaps.

---

## State Machine Testing

Most robot controllers are state machines. Test transitions explicitly:

```python
def test_transitions_from_idle_to_moving_on_goal():
    robot = RobotController()
    assert robot.state == State.IDLE
    robot.set_goal(5.0, 5.0)
    robot.update()
    assert robot.state == State.MOVING

def test_invalid_transition_raises():
    robot = RobotController()
    with pytest.raises(InvalidTransitionError):
        robot.execute_task()  # Cannot execute from IDLE without a goal
```

---

## Common Mistakes

| Mistake                                                | Fix                                                       |
| ------------------------------------------------------ | --------------------------------------------------------- |
| Testing only with clean/ideal sensor data              | Always inject noise and faults                            |
| Not testing `frame_id` on published messages           | Assert frame on every ROS2 output                         |
| Control logic coupled to hardware calls                | Introduce HAL interface first                             |
| Running full node graph for unit tests                 | Call callbacks directly; spin only for integration tests  |
| Skipping safety limit tests                            | Safety limits must have explicit test coverage            |
| Only testing Python scenario with property-based tests | Apply to all platforms — LiDAR ranges, joint angles, etc. |
| Going to hardware before simulation passes             | Simulation first, always                                  |
| Ignoring QoS mismatches in ROS2                        | Test QoS compatibility explicitly                         |
