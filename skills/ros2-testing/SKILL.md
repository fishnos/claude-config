---
name: ros2-testing
description: Testing robotics code in ROS 2 — unit tests with gtest and pytest, node-level tests, multi-node integration tests with launch_testing, simulation tests in Gazebo, hardware-in-the-loop, and CI. Use when writing or reviewing any ROS 2 test, deciding what to test at which layer, setting up colcon test in a package, debugging a flaky robotics test, testing timing or sim-time behavior, or building CI for a robot workspace.
paths: "**/*.urdf,**/*.xacro,**/*.sdf,**/*.world,**/package.xml,**/launch/**,**/*.msg,**/*.srv,**/*.action"
---

# ROS 2 testing

Robotics testing fights one enemy: **non-determinism**. Concurrency, wall-clock timing, physics, message ordering, and real hardware all inject variance a test can't control. Every technique here is about pushing determinism as far down the stack as possible, so that the parts that must be non-deterministic are small, isolated, and run rarely.

Pair with `google-testing` for the general discipline — sizes, doubles, DAMP, behavior naming. This skill is the ROS 2 application of it.

## The single highest-leverage rule

**Separate the algorithm from the ROS plumbing.**

A node that computes _and_ subscribes _and_ publishes can only be tested by standing up a graph. Split it: a plain class or function with no ROS dependencies holding the logic, and a thin node that wires topics to it.

```python
# planner_core.py — no rclpy import anywhere in this file
def compute_velocity(pose: Pose2D, goal: Pose2D, limits: Limits) -> Twist2D:
    ...

# planner_node.py — adapter only
class PlannerNode(Node):
    def _on_pose(self, msg):
        self._pub.publish(to_twist_msg(
            compute_velocity(from_pose_msg(msg), self._goal, self._limits)))
```

Now the interesting behavior — saturation, edge cases, singularities, unit conversions, frame transforms — is covered by fast, hermetic, millisecond unit tests that need no executor, no discovery, and no clock. What's left in the node is wiring, which integration tests cover once.

Most "we can't test our robot code" is really "our logic is welded to `rclpy`."

## Test layers

| Layer                    | Tool                                       | What it proves                                                       | Runs                             |
| ------------------------ | ------------------------------------------ | -------------------------------------------------------------------- | -------------------------------- |
| **Logic unit**           | pytest / gtest, no ROS                     | Algorithms, math, state machines, conversions                        | Every commit, milliseconds       |
| **Node unit**            | pytest / gtest + rclpy/rclcpp, single node | Callbacks fire, params parse, QoS is right, lifecycle transitions    | Every commit, sub-second         |
| **Integration**          | `launch_testing`                           | Multiple nodes actually talk; the graph comes up; nodes exit cleanly | Every commit, seconds            |
| **Simulation**           | Gazebo + launch_testing                    | Closed-loop behavior against physics                                 | Every commit or nightly, minutes |
| **Hardware-in-the-loop** | Test rig                                   | The real driver, real timing, real hardware quirks                   | Nightly / pre-release            |
| **Field**                | Manual + rosbag capture                    | It works in the world                                                | Per milestone                    |

Same 80/15/5 principle as elsewhere: the pyramid's base is logic and node units. Sim and HIL are the expensive tip — valuable, but they can't be your primary feedback loop.

## Running tests

```bash
colcon test                                    # build + run, whole workspace
colcon test --packages-select my_pkg           # one package
colcon test --event-handlers console_cohesion+ # see output as it runs
colcon test-result --all --verbose             # which cases failed, and why
colcon test --packages-select my_pkg --pytest-args -k test_name   # one pytest function
```

`colcon test-result --all --verbose` is the one people forget — `colcon test` reports pass/fail counts, not failure detail. Sourcing the workspace before testing is not necessary; `colcon test` sets up the environment.

## C++ unit tests (gtest)

`package.xml`:

```xml
<test_depend>ament_cmake_gtest</test_depend>
```

`CMakeLists.txt`:

```cmake
if(BUILD_TESTING)
  find_package(ament_cmake_gtest REQUIRED)
  ament_add_gtest(${PROJECT_NAME}_planner_test test/test_planner.cpp)
  target_include_directories(${PROJECT_NAME}_planner_test PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>)
  target_link_libraries(${PROJECT_NAME}_planner_test ${PROJECT_NAME}_lib)
endif()
```

`ament_add_gtest` behaves like `add_executable` — you still link and set includes yourself. The `BUILD_TESTING` guard keeps tests out of production builds.

Build the package's logic as a **library** and link both the node executable and the tests against it. A package whose logic only exists inside `main()` can't be unit tested.

Use `ament_add_gmock` when you need interface doubles. Prefer a real object or a fake first — see `google-testing` on why mocks are the last resort.

## Python unit tests (pytest)

`setup.py`:

```python
extras_require={'test': ['pytest']},
```

Tests live in `test/` (what `ros2 pkg create` generates) or `tests/`; pick one and be consistent. Files must match `test_*.py`.

`ament_python` package templates ship linter tests — `test_copyright.py`, `test_flake8.py`, `test_pep257.py`. Keep them. They're free, and they're what keeps a workspace from drifting.

For `ament_cmake_python` packages, register with `ament_add_pytest_test`:

```cmake
if(BUILD_TESTING)
  find_package(ament_cmake_pytest REQUIRED)
  ament_add_pytest_test(planner_tests test/test_planner.py)
endif()
```

## Node-level tests

Testing a node in-process, without a launch file:

```python
import pytest, rclpy
from my_pkg.planner_node import PlannerNode

@pytest.fixture
def ros():
    rclpy.init()
    yield
    rclpy.shutdown()

def test_publishes_zero_velocity_when_at_goal(ros):
    node = PlannerNode()
    received = []
    sub = node.create_subscription(Twist, '/cmd_vel', received.append, 10)
    try:
        node.on_pose(pose_at_goal())
        deadline = time.monotonic() + 2.0
        while not received and time.monotonic() < deadline:
            rclpy.spin_once(node, timeout_sec=0.1)
        assert received, 'no /cmd_vel published within 2s'
        assert received[0].linear.x == pytest.approx(0.0)
    finally:
        node.destroy_node()
```

Rules:

- **Never `rclpy.spin()`** in a test — it blocks forever. Use `spin_once(timeout_sec=...)` in a bounded loop, or `spin_until_future_complete`.
- **Always bound the wait**, and fail with a message naming what didn't arrive. A test that hangs is worse than one that fails.
- `rclpy.init()`/`shutdown()` in a fixture (or `setUpClass`/`tearDownClass`), `destroy_node()` in teardown. Leaked nodes bleed into later tests.
- Create a **fresh node per test**, so tests can't communicate through leftover state.
- For services, `wait_for_service(timeout_sec=...)` before calling — never assume the server is up.

## Integration tests (launch_testing)

`launch_testing` extends a Python launch file with tests that run _while_ the nodes run, plus tests that run after shutdown. It's built on `unittest`.

```python
import unittest, time
import launch, launch_ros, launch_testing.actions
import rclpy
from turtlesim_msgs.msg import Pose


def generate_test_description():
    return launch.LaunchDescription([
        launch_ros.actions.Node(
            package='turtlesim', executable='turtlesim_node', name='turtle1'),
        launch.actions.TimerAction(
            period=0.5, actions=[launch_testing.actions.ReadyToTest()]),
    ]), {}


class TestTurtleSim(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        rclpy.init()

    @classmethod
    def tearDownClass(cls):
        rclpy.shutdown()

    def setUp(self):
        self.node = rclpy.create_node('test_turtlesim')

    def tearDown(self):
        self.node.destroy_node()

    def test_publishes_pose(self, proc_output):
        msgs = []
        sub = self.node.create_subscription(Pose, 'turtle1/pose', msgs.append, 100)
        try:
            end = time.time() + 10
            while time.time() < end:
                rclpy.spin_once(self.node, timeout_sec=1)
            assert len(msgs) > 100
        finally:
            self.node.destroy_subscription(sub)

    def test_logs_spawning(self, proc_output):
        proc_output.assertWaitFor(
            'Spawning turtle [turtle1] at x=', timeout=5, stream='stderr')


@launch_testing.post_shutdown_test()
class TestTurtleSimShutdown(unittest.TestCase):
    def test_exit_codes(self, proc_info):
        launch_testing.asserts.assertExitCodes(proc_info)
```

The four load-bearing pieces:

1. `generate_test_description()` — what to launch, ending with `ReadyToTest()` so the framework knows when to start.
2. An undecorated `unittest.TestCase` — active tests. `proc_output` gives you process stdout/stderr.
3. `@launch_testing.post_shutdown_test()` — runs after nodes exit.
4. `assertExitCodes(proc_info)` — **always include this.** A node that crashes on shutdown passes every active test and still fails in the field.

`launch_testing_ros` provides helpers like `WaitForTopics` that replace hand-rolled spin loops.

### Registering the test — isolation matters

Nodes in tests running in parallel **will** discover each other and cross-talk unless isolated by `ROS_DOMAIN_ID`. Register through the isolated runner:

```cmake
if(BUILD_TESTING)
  find_package(ament_cmake_ros REQUIRED)
  find_package(launch_testing_ament_cmake REQUIRED)
  function(add_ros_isolated_launch_test path)
    set(RUNNER "${ament_cmake_ros_DIR}/run_test_isolated.py")
    add_launch_test("${path}" RUNNER "${RUNNER}" ${ARGN})
  endfunction()
  add_ros_isolated_launch_test(test/test_integration.py)
endif()
```

`package.xml`:

```xml
<test_depend>ament_cmake_ros</test_depend>
<test_depend>launch</test_depend>
<test_depend>launch_ros</test_depend>
<test_depend>launch_testing</test_depend>
<test_depend>launch_testing_ament_cmake</test_depend>
<test_depend>rclpy</test_depend>
```

`launch_pytest` is the pytest-native alternative to `launch_testing` — same idea, fixtures instead of `unittest`. Either is fine; be consistent within a workspace.

## Time

Wall-clock timing is the top source of robotics test flakiness.

- **Never `sleep()` to wait for a result.** Wait on the condition with a timeout.
- Use **sim time** for anything timing-dependent: set `use_sim_time: true`, publish `/clock`, and the node's `get_clock()` follows simulation, not the wall. Now a 30-second behavior runs in whatever wall time the sim takes.
- Don't test "it published within 100ms" unless latency _is_ the requirement. Test that it published, and what it published.
- Timeouts are failure detection, not synchronization. Set them generously (seconds), and never tune a timeout upward to fix flakiness — that's masking a real race.

## Simulation tests (Gazebo)

Sim tests are integration tests with physics attached. They catch closed-loop bugs nothing else will, and they're slow and flaky if undisciplined.

- **Headless in CI.** Run server-only, no GUI, no rendering: `gz sim -s -r --headless-rendering`. Rendering pulls in GPU drivers that CI usually lacks and adds nondeterminism.
- **Launch through `ros_gz_sim`** with `gz_args`, and bridge with `ros_gz_bridge`. Bridge `/clock` and set `use_sim_time` on every node in the test, including the test node itself — a mixed-clock graph produces bugs that look like physics problems.
- **Fix every seed** — noise models, sensor noise, spawn jitter, any RNG. An unseeded sim test is a random test.
- **Purpose-built minimal worlds.** A test world contains what the test needs and nothing else. Loading the full factory model to check a gripper's grasp makes the test slow and couples it to unrelated assets.
- **Assert with tolerances, never float equality.** `assert pose.x == pytest.approx(1.0, abs=0.05)`. Physics is approximate; pick a tolerance the requirement justifies and comment why.
- **Assert on outcomes, not trajectories.** "Reached the goal within 5 cm" survives a solver update; "followed exactly this path" doesn't — that's a change-detector test with a physics engine attached.
- **Bound every sim test in sim-time**, and fail if the goal isn't reached before the deadline. A control bug otherwise means a hanging job.

## Rosbags as test fixtures

Recorded data is the bridge between field behavior and repeatable tests.

- Capture a bag when you hit a real-world bug, trim it to the relevant window, commit it as a fixture (Git LFS if large), and write a test that replays it and asserts the bug is gone. This is the robotics equivalent of a regression test.
- `ros2 bag play --clock` to drive sim time from the recording; set `use_sim_time` on consumers.
- `--rate` and `--start-offset` to control replay; run as fast as the pipeline allows in CI.
- Keep fixtures small and documented — a bag with no note about what it captures becomes unmaintainable within a year.

## Hardware-in-the-loop

- **Never in PR CI.** HIL is nightly or pre-release. Blocking a PR on a physical rig means one jammed servo blocks the whole team.
- **Tag them separately** so `colcon test` on a dev machine doesn't try to actuate hardware. A dedicated package (`my_robot_hil_tests`) or a pytest marker plus a `--ctest-args -L` label both work.
- **Safety is part of the test.** E-stop reachable, workspace clear, motion bounded by software limits, and a fixture that returns the robot to a safe pose in teardown even when the test fails. Teardown must run on failure — `try/finally` or a fixture, never end-of-test cleanup code.
- **The layer below must pass first.** HIL exists to catch what sim can't model: real timing, driver quirks, sensor noise, mechanical slop, thermal drift. If a bug can be caught in sim, it belongs in sim.
- Log everything: record a bag of every HIL run. When a nightly fails at 3am, the bag is all you have.

## CI

```yaml
# GitHub Actions
- uses: ros-tooling/setup-ros@v0.7
  with: { required-ros-distributions: jazzy }
- uses: ros-tooling/action-ros-ci@v0.4
  with:
    package-name: my_pkg
    target-ros2-distro: jazzy
```

- Matrix across the distros you support. Per REP-2000, currently active: **Humble** (LTS, to May 2027), **Jazzy** (LTS, to May 2029), **Kilted** (to Nov 2026), and **Rolling** (development). Test against Rolling in a nightly job — it's your early warning for breakage in the next distro.
- Run in the official `osrf/ros:<distro>-desktop` image so CI matches developer environments.
- `industrial_ci` is the mature turnkey option if you'd rather not assemble a pipeline.
- Coverage: build with `--cmake-args -DCMAKE_CXX_FLAGS="--coverage"` and aggregate with `colcon lcov-result`; `pytest-cov` for Python.
- Always publish the JUnit XML that `colcon test` produces, so failures are readable without digging into logs.

## Flakiness

A flaky robotics test is a bug report, not a scheduling problem. Ranked by how often they're the actual cause:

1. **Unbounded or wall-clock waits** → bound them, or move to sim time.
2. **Missing domain isolation** → `run_test_isolated.py`; parallel tests are discovering each other.
3. **Discovery races** — publishing before a subscriber matched, so the first messages vanish → wait for the match (`get_subscription_count() > 0`) or use transient-local QoS.
4. **QoS mismatch** — incompatible reliability/durability means the connection silently never forms. Nothing errors; you just get no data.
5. **Leaked state between tests** — a node, executor, or parameter that outlived its test.
6. **Unseeded randomness** in sim or noise models.

Never fix flakiness with a retry. A retried test tells you nothing about whether the system works.

## Reviewing robotics tests

On top of the `google-testing` checklist:

- Is the logic testable without ROS, and is it tested that way?
- Is every wait bounded, with a message naming what timed out?
- Does the integration test assert clean exit codes?
- Are sim assertions tolerance-based and outcome-based?
- Are seeds fixed?
- Does teardown run on failure — especially anything touching hardware?
- Would this test still pass after a physics-engine or planner-internals update, given the same behavior?
