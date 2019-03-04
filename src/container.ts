import Mediator from './mediator';
import layoutManager from './layoutManager';
import { hasClass, addClass, removeClass, getParent } from './utils';
import { domDropHandler } from './dropHandlers';
import {
  wrapperClass,
  animationClass,
  stretcherElementClass,
  stretcherElementInstance,
  translationValue,
  containerClass,
  containerInstance,
  containersInDraggable,
} from './constants';
import {
  SmoothDnD,
  ContainerOptions,
  ElementX,
  IContainer,
  DragInfo,
  ContainerProps,
  DraggableInfo,
  DragResult,
  SmoothDnDCreator,
} from './interfaces';

const defaultOptions: ContainerOptions = {
  groupName: undefined,
  behaviour: 'move', // move | copy
  orientation: 'vertical', // vertical | horizontal
  getChildPayload: undefined,
  animationDuration: 250,
  autoScrollEnabled: true,
  shouldAcceptDrop: undefined,
  shouldAnimateDrop: undefined,
};

function setAnimation(element: HTMLElement, add: boolean, animationDuration = defaultOptions.animationDuration) {
  if (add) {
    addClass(element, animationClass);
    element.style.transitionDuration = animationDuration + 'ms';
  } else {
    removeClass(element, animationClass);
    element.style.removeProperty('transition-duration');
  }
}

function getContainer(element: ElementX) {
  return element ? element[containerInstance] : null;
}

function initOptions(props = defaultOptions): ContainerOptions {
  return Object.assign({}, defaultOptions, props);
}

function isDragRelevant({ element, options }: ContainerProps) {
  return function(sourceContainer: IContainer, payload: any) {
    if (options.shouldAcceptDrop) {
      return options.shouldAcceptDrop(sourceContainer.getOptions(), payload);
    }
    const sourceOptions = sourceContainer.getOptions();
    if (options.behaviour === 'copy') return false;

    const parentWrapper = getParent(element, '.' + wrapperClass);
    if (parentWrapper === sourceContainer.element) {
      return false;
    }

    if (sourceContainer.element === element) return true;
    if (sourceOptions.groupName && sourceOptions.groupName === options.groupName) return true;

    return false;
  };
}

function wrapChild(child: HTMLElement) {
  if (smoothDnD.wrapChild) {
    const div = global.document.createElement('div');
    div.className = `${wrapperClass}`;
    child.parentElement!.insertBefore(div, child);
    div.appendChild(child);
    return div;
  }

  return child;
}

function wrapChildren(element: HTMLElement) {
  const draggables: ElementX[] = [];
  Array.prototype.forEach.call(element.children, (child: ElementX) => {
    if (child.nodeType === Node.ELEMENT_NODE) {
      let wrapper = child;
      if (!hasClass(child, wrapperClass)) {
        wrapper = wrapChild(child);
      }
      wrapper[containersInDraggable] = [];
      wrapper[translationValue] = 0;
      draggables.push(wrapper);
    } else {
      element.removeChild(child);
    }
  });
  return draggables;
}

function unwrapChildren(element: HTMLElement) {
  if (smoothDnD.wrapChild) {
    Array.prototype.forEach.call(element.children, (child: HTMLElement) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (hasClass(child, wrapperClass)) {
          element.insertBefore(child.firstElementChild as HTMLElement, child);
          element.removeChild(child);
        }
      }
    });
  }
}

function findDraggebleAtPos({ layout }: { layout: ReturnType<typeof layoutManager> }) {
  const find = (
    draggables: HTMLElement[],
    pos: number,
    startIndex: number,
    endIndex: number,
    withRespectToMiddlePoints = false
  ): number | null => {
    if (endIndex < startIndex) {
      return startIndex;
    }
    // binary serach draggable
    if (startIndex === endIndex) {
      let { begin, end } = layout.getBeginEnd(draggables[startIndex]);
      // mouse pos is inside draggable
      // now decide which index to return
      if (pos > begin && pos <= end) {
        if (withRespectToMiddlePoints) {
          return pos < (end + begin) / 2 ? startIndex : startIndex + 1;
        } else {
          return startIndex;
        }
      } else {
        return null;
      }
    } else {
      const middleIndex = Math.floor((endIndex + startIndex) / 2);
      const { begin, end } = layout.getBeginEnd(draggables[middleIndex]);
      if (pos < begin) {
        return find(draggables, pos, startIndex, middleIndex - 1, withRespectToMiddlePoints);
      } else if (pos > end) {
        return find(draggables, pos, middleIndex + 1, endIndex, withRespectToMiddlePoints);
      } else {
        if (withRespectToMiddlePoints) {
          return pos < (end + begin) / 2 ? middleIndex : middleIndex + 1;
        } else {
          return middleIndex;
        }
      }
    }
  };

  return (draggables: HTMLElement[], pos: number, withRespectToMiddlePoints = false) => {
    return find(draggables, pos, 0, draggables.length - 1, withRespectToMiddlePoints);
  };
}

function resetDraggables({ element, draggables, layout }: ContainerProps) {
  return function() {
    draggables.forEach((p: ElementX) => {
      setAnimation(p, false);
      layout.setTranslation(p, 0);
      layout.setVisibility(p, true);
      p[containersInDraggable] = [];
    });

    if (element[stretcherElementInstance]) {
      element[stretcherElementInstance].parentNode.removeChild(element[stretcherElementInstance]);
      element[stretcherElementInstance] = null;
    }
  };
}

function setTargetContainer(draggableInfo: DraggableInfo, element: HTMLElement, set = true) {
  if (element && set) {
    draggableInfo.targetElement = element;
  } else {
    if (draggableInfo.targetElement === element) {
      draggableInfo.targetElement = null;
    }
  }
}

function handleDrop({ element, draggables, layout, options }: ContainerProps) {
  const draggablesReset = resetDraggables({ element, draggables, layout, options });
  const dropHandler = (smoothDnD.dropHandler || domDropHandler)({ element, draggables, layout, options });
  return function(draggableInfo: DraggableInfo, { addedIndex, removedIndex }: DragResult) {
    draggablesReset();
    // if drop zone is valid => complete drag else do nothing everything will be reverted by draggablesReset()
    if (draggableInfo.targetElement || options.removeOnDropOut) {
      let actualAddIndex =
        addedIndex !== null ? (removedIndex !== null && removedIndex < addedIndex ? addedIndex - 1 : addedIndex) : null;
      const dropHandlerParams = {
        removedIndex,
        addedIndex: actualAddIndex,
        payload: draggableInfo.payload,
        droppedElement: draggableInfo.element.firstElementChild,
      };
      dropHandler(dropHandlerParams, options.onDrop);
    }
  };
}

function getContainerProps(element: HTMLElement, initialOptions: ContainerOptions): ContainerProps {
  const options = initOptions(initialOptions);
  const draggables = wrapChildren(element);
  // set flex classes before layout is inited for scroll listener
  addClass(element, `${containerClass} ${options.orientation}`);
  const layout = layoutManager(element, options.orientation!, options.animationDuration!);
  return {
    element,
    draggables,
    options,
    layout,
  };
}

function getRelaventParentContainer(container: IContainer, relevantContainers: IContainer[]) {
  let current: ElementX | null = container.element;
  while (current) {
    const containerOfParentElement = getContainer(current.parentElement as ElementX);
    if (containerOfParentElement && relevantContainers.indexOf(containerOfParentElement) > -1) {
      return {
        container: containerOfParentElement,
        draggable: current,
      };
    }
    current = current.parentElement;
  }

  return null;
}

function registerToParentContainer(container: IContainer, relevantContainers: IContainer[]) {
  const parentInfo = getRelaventParentContainer(container, relevantContainers);
  if (parentInfo) {
    parentInfo.container.getChildContainers().push(container);
    container.setParentContainer(parentInfo.container);
    //current should be draggable
    parentInfo.draggable[containersInDraggable].push(container);
  }
}

function getRemovedItem({ element, options }: ContainerProps) {
  let prevRemovedIndex: number | null = null;
  return ({ draggableInfo }: DragInfo) => {
    let removedIndex = prevRemovedIndex;
    if (prevRemovedIndex == null && draggableInfo.container.element === element && options.behaviour !== 'copy') {
      removedIndex = prevRemovedIndex = draggableInfo.elementIndex;
    }

    return { removedIndex };
  };
}

function setRemovedItemVisibilty({ draggables, layout }: ContainerProps) {
  return ({ dragResult }: DragInfo) => {
    if (dragResult.removedIndex !== null) {
      layout.setVisibility(draggables[dragResult.removedIndex], false);
    }
  };
}

function getPosition({ element, layout }: ContainerProps) {
  return ({ draggableInfo }: DragInfo) => {
    return {
      pos: !getContainer(element).isPosInChildContainer() ? layout.getPosition(draggableInfo.position) : null,
    };
  };
}

function notifyParentOnPositionCapture({ element }: ContainerProps) {
  let isCaptured = false;
  return ({ dragResult }: DragInfo) => {
    if (getContainer(element).getParentContainer() && isCaptured !== (dragResult.pos !== null)) {
      isCaptured = dragResult.pos !== null;
      getContainer(element)
        .getParentContainer()
        .onChildPositionCaptured(isCaptured);
    }
  };
}

function getElementSize({ layout }: ContainerProps) {
  let elementSize: number | null = null;
  return ({ draggableInfo, dragResult }: DragInfo) => {
    if (dragResult.pos === null) {
      return (elementSize = null);
    } else {
      elementSize = elementSize || layout.getSize(draggableInfo.element);
    }
    return { elementSize };
  };
}

function handleTargetContainer({ element }: ContainerProps) {
  return ({ draggableInfo, dragResult }: DragInfo) => {
    setTargetContainer(draggableInfo, element, !!dragResult.pos);
  };
}

function getDragInsertionIndex({ draggables, layout }: ContainerProps) {
  const findDraggable = findDraggebleAtPos({ layout });
  return ({ dragResult: { shadowBeginEnd, pos } }: { dragResult: DragResult }) => {
    if (!shadowBeginEnd) {
      const index = findDraggable(draggables, pos, true);
      return index !== null ? index : draggables.length;
    } else {
      if (shadowBeginEnd.begin + shadowBeginEnd.beginAdjustment <= pos && shadowBeginEnd.end >= pos) {
        // position inside ghost
        return null;
      }
    }

    if (pos < shadowBeginEnd.begin + shadowBeginEnd.beginAdjustment) {
      return findDraggable(draggables, pos);
    } else if (pos > shadowBeginEnd.end) {
      return findDraggable(draggables, pos)! + 1;
    } else {
      return draggables.length;
    }
  };
}

function getDragInsertionIndexForDropZone() {
  return ({ dragResult: { pos } }: DragInfo) => {
    return pos !== null ? { addedIndex: 0 } : { addedIndex: null };
  };
}

function getShadowBeginEndForDropZone({ draggables, layout }: ContainerProps) {
  let prevAddedIndex: number | null = null;
  return ({ dragResult: { addedIndex } }: DragInfo) => {
    if (addedIndex !== prevAddedIndex) {
      prevAddedIndex = addedIndex;
      const { begin, end } = layout.getBeginEndOfContainer();
      return {
        shadowBeginEnd: {
          rect: layout.getTopLeftOfElementBegin(begin),
        },
      };
    }

    return null;
  };
}

function invalidateShadowBeginEndIfNeeded(params: ContainerProps) {
  const shadowBoundsGetter = getShadowBeginEnd(params);
  return ({ draggableInfo, dragResult }: DragInfo) => {
    if (draggableInfo.invalidateShadow) {
      return shadowBoundsGetter({ draggableInfo, dragResult });
    }
    return null;
  };
}

function getNextAddedIndex(params: ContainerProps) {
  const getIndexForPos = getDragInsertionIndex(params);
  return ({ dragResult }: DragInfo) => {
    let index = null;
    if (dragResult.pos !== null) {
      index = getIndexForPos({ dragResult });
      if (index === null) {
        index = dragResult.addedIndex;
      }
    }
    return {
      addedIndex: index,
    };
  };
}

function resetShadowAdjustment() {
  let lastAddedIndex: number | null = null;
  return ({ dragResult: { addedIndex, shadowBeginEnd } }: DragInfo) => {
    if (addedIndex !== lastAddedIndex && lastAddedIndex !== null && shadowBeginEnd) {
      shadowBeginEnd.beginAdjustment = 0;
    }
    lastAddedIndex = addedIndex;
  };
}

function handleInsertionSizeChange({ element, draggables, layout, options }: ContainerProps) {
  let strectherElement: HTMLElement | null = null;
  return function({ dragResult: { addedIndex, removedIndex, elementSize } }: DragInfo) {
    if (removedIndex === null) {
      if (addedIndex !== null) {
        if (!strectherElement) {
          const containerBeginEnd = layout.getBeginEndOfContainer();
          containerBeginEnd.end = containerBeginEnd.begin + layout.getSize(element);
          const hasScrollBar = layout.getScrollSize(element) > layout.getSize(element);
          const containerEnd = hasScrollBar
            ? containerBeginEnd.begin + layout.getScrollSize(element) - layout.getScrollValue(element)
            : containerBeginEnd.end;
          const lastDraggableEnd =
            draggables.length > 0
              ? layout.getBeginEnd(draggables[draggables.length - 1]).end - draggables[draggables.length - 1][translationValue]
              : containerBeginEnd.begin;
          if (lastDraggableEnd + elementSize > containerEnd) {
            strectherElement = global.document.createElement('div') as HTMLElement;
            strectherElement.className = stretcherElementClass + ' ' + options.orientation;
            const stretcherSize = elementSize + lastDraggableEnd - containerEnd;
            layout.setSize(strectherElement.style, `${stretcherSize}px`);
            element.appendChild(strectherElement);
            element[stretcherElementInstance] = strectherElement;
            return {
              containerBoxChanged: true,
            };
          }
        }
      } else {
        if (strectherElement) {
          layout.setTranslation(strectherElement, 0);
          let toRemove = strectherElement;
          strectherElement = null;
          element.removeChild(toRemove);
          element[stretcherElementInstance] = null;
          return {
            containerBoxChanged: true,
          };
        }
      }
    }

    return undefined;
  };
}

function calculateTranslations({ draggables, layout }: ContainerProps) {
  let prevAddedIndex: number | null = null;
  let prevRemovedIndex: number | null = null;
  return function({ dragResult: { addedIndex, removedIndex, elementSize } }: { dragResult: DragResult }) {
    if (addedIndex !== prevAddedIndex || removedIndex !== prevRemovedIndex) {
      for (let index = 0; index < draggables.length; index++) {
        if (index !== removedIndex) {
          const draggable = draggables[index];
          let translate = 0;
          if (removedIndex !== null && removedIndex < index) {
            translate -= layout.getSize(draggables[removedIndex]);
          }
          if (addedIndex !== null && addedIndex <= index) {
            translate += elementSize;
          }
          layout.setTranslation(draggable, translate);
        }
      }

      prevAddedIndex = addedIndex;
      prevRemovedIndex = removedIndex;

      return { addedIndex, removedIndex };
    }

    return undefined;
  };
}

function getShadowBeginEnd({ draggables, layout }: ContainerProps) {
  let prevAddedIndex: number | null = null;
  return ({ draggableInfo, dragResult }: DragInfo) => {
    const { addedIndex, removedIndex, elementSize, pos, shadowBeginEnd } = dragResult;
    if (pos !== null) {
      if (addedIndex !== null && (draggableInfo.invalidateShadow || addedIndex !== prevAddedIndex)) {
        if (prevAddedIndex) prevAddedIndex = addedIndex;
        let beforeIndex = addedIndex - 1;
        let begin = 0;
        let afterBounds = null;
        let beforeBounds = null;
        if (beforeIndex === removedIndex) {
          beforeIndex--;
        }
        if (beforeIndex > -1) {
          const beforeSize = layout.getSize(draggables[beforeIndex]);
          beforeBounds = layout.getBeginEnd(draggables[beforeIndex]);
          if (elementSize < beforeSize) {
            const threshold = (beforeSize - elementSize) / 2;
            begin = beforeBounds.end - threshold;
          } else {
            begin = beforeBounds.end;
          }
        } else {
          beforeBounds = { end: layout.getBeginEndOfContainer().begin };
        }

        let end = 10000;
        let afterIndex = addedIndex;
        if (afterIndex === removedIndex) {
          afterIndex++;
        }
        if (afterIndex < draggables.length) {
          const afterSize = layout.getSize(draggables[afterIndex]);
          afterBounds = layout.getBeginEnd(draggables[afterIndex]);

          if (elementSize < afterSize) {
            const threshold = (afterSize - elementSize) / 2;
            end = afterBounds.begin + threshold;
          } else {
            end = afterBounds.begin;
          }
        } else {
          afterBounds = { begin: layout.getContainerRectangles().rect.end };
        }

        const shadowRectTopLeft = beforeBounds && afterBounds ? layout.getTopLeftOfElementBegin(beforeBounds.end) : null;

        return {
          shadowBeginEnd: {
            begin,
            end,
            rect: shadowRectTopLeft,
            beginAdjustment: shadowBeginEnd ? shadowBeginEnd.beginAdjustment : 0,
          },
        };
      } else {
        return null;
      }
    } else {
      prevAddedIndex = null;
      return {
        shadowBeginEnd: null,
      };
    }
  };
}

function handleFirstInsertShadowAdjustment() {
  let lastAddedIndex: number | null = null;
  return ({ dragResult: { pos, addedIndex, shadowBeginEnd } }: DragInfo) => {
    if (pos !== null) {
      if (addedIndex != null && lastAddedIndex === null) {
        if (pos < shadowBeginEnd.begin) {
          const beginAdjustment = pos - shadowBeginEnd.begin - 5;
          shadowBeginEnd.beginAdjustment = beginAdjustment;
        }
        lastAddedIndex = addedIndex;
      }
    } else {
      lastAddedIndex = null;
    }
  };
}

function fireDragEnterLeaveEvents({ options }: ContainerProps) {
  let wasDragIn = false;
  return ({ dragResult: { pos } }: DragInfo) => {
    const isDragIn = !!pos;
    if (isDragIn !== wasDragIn) {
      wasDragIn = isDragIn;
      if (isDragIn) {
        options.onDragEnter && options.onDragEnter();
      } else {
        options.onDragLeave && options.onDragLeave();
        return {
          dragLeft: true,
        };
      }
    }

    return undefined;
  };
}

function fireOnDropReady({ options }: ContainerProps) {
  let lastAddedIndex: number | null = null;
  return ({ dragResult: { addedIndex, removedIndex }, draggableInfo: { payload, element } }: DragInfo) => {
    if (options.onDropReady && addedIndex !== null && lastAddedIndex !== addedIndex) {
      lastAddedIndex = addedIndex;
      let adjustedAddedIndex = addedIndex;

      if (removedIndex !== null && addedIndex > removedIndex) {
        adjustedAddedIndex--;
      }

      options.onDropReady({
        addedIndex: adjustedAddedIndex,
        removedIndex,
        payload,
        element: element.firstElementChild as HTMLElement,
      });
    }
  };
}

function getDragHandler(params: any) {
  if (params.options.behaviour === 'drop-zone') {
    // sorting is disabled in container, addedIndex will always be 0 if dropped in
    return compose(params)(
      getRemovedItem,
      setRemovedItemVisibilty,
      getPosition,
      notifyParentOnPositionCapture,
      getElementSize,
      handleTargetContainer,
      getDragInsertionIndexForDropZone,
      getShadowBeginEndForDropZone,
      fireDragEnterLeaveEvents,
      fireOnDropReady
    );
  } else {
    return compose(params)(
      getRemovedItem,
      setRemovedItemVisibilty,
      getPosition,
      notifyParentOnPositionCapture,
      getElementSize,
      handleTargetContainer,
      invalidateShadowBeginEndIfNeeded,
      getNextAddedIndex,
      resetShadowAdjustment,
      handleInsertionSizeChange,
      calculateTranslations,
      getShadowBeginEnd,
      handleFirstInsertShadowAdjustment,
      fireDragEnterLeaveEvents,
      fireOnDropReady
    );
  }
}

function getDefaultDragResult() {
  return {
    addedIndex: null,
    removedIndex: null,
    elementSize: null,
    pos: null,
    shadowBeginEnd: null,
  };
}

function compose(params: any) {
  return (...functions: any[]) => {
    const hydratedFunctions = functions.map(p => p(params));
    let result: DragResult | null = null;
    return (draggableInfo: DraggableInfo) => {
      result = hydratedFunctions.reduce((dragResult, fn) => {
        return Object.assign(dragResult, fn({ draggableInfo, dragResult }));
      }, result || getDefaultDragResult());
      return result;
    };
  };
}

// Container definition begin
function Container(element: HTMLElement): (options: ContainerOptions) => any {
  return function(options: ContainerOptions) {
    let dragResult: DragResult | null = null;
    let lastDraggableInfo: DraggableInfo | null = null;
    const props = getContainerProps(element, options);
    let dragHandler = getDragHandler(props);
    let dropHandler = handleDrop(props);
    let parentContainer: IContainer | null = null;
    let posIsInChildContainer = false;
    let childContainers: IContainer[] = [];

    function processLastDraggableInfo() {
      if (lastDraggableInfo !== null) {
        lastDraggableInfo.invalidateShadow = true;
        dragResult = dragHandler(lastDraggableInfo!);
        lastDraggableInfo.invalidateShadow = false;
      }
    }

    function onChildPositionCaptured(isCaptured: boolean) {
      posIsInChildContainer = isCaptured;
      if (parentContainer) {
        parentContainer.onChildPositionCaptured(isCaptured);
        if (lastDraggableInfo) {
          dragResult = dragHandler(lastDraggableInfo);
        }
      }
    }

    function setDraggables(draggables: HTMLElement[], element: HTMLElement) {
      const newDraggables = wrapChildren(element);
      for (let i = 0; i < newDraggables.length; i++) {
        draggables[i] = newDraggables[i];
      }

      for (let i = 0; i < draggables.length - newDraggables.length; i++) {
        draggables.pop();
      }
    }

    function prepareDrag(container: IContainer, relevantContainers: IContainer[]) {
      const element = container.element;
      const draggables = props.draggables;
      const options = container.getOptions();
      setDraggables(draggables, element);
      container.layout.invalidateRects();
      registerToParentContainer(container, relevantContainers);
      draggables.forEach(p => setAnimation(p, true, options.animationDuration));
    }

    props.layout.setScrollListener(function() {
      processLastDraggableInfo();
    });

    function handleDragLeftDeferedTranslation() {
      if (dragResult && dragResult.dragLeft && props.options.behaviour !== 'drop-zone') {
        dragResult.dragLeft = false;
        setTimeout(() => {
          if (dragResult) {
            calculateTranslations(props)({ dragResult });
          }
        }, 20);
      }
    }

    function dispose(container: IContainer) {
      unwrapChildren(container.element);
    }

    const container: IContainer = {
      element,
      draggables: props.draggables,
      isDragRelevant: isDragRelevant(props),
      getScale: props.layout.getContainerScale,
      layout: props.layout,
      getChildContainers: () => childContainers,
      onChildPositionCaptured,
      dispose,
      prepareDrag,
      isPosInChildContainer: () => posIsInChildContainer,
      handleDrag(draggableInfo: DraggableInfo) {
        lastDraggableInfo = draggableInfo;
        dragResult = dragHandler(draggableInfo);
        handleDragLeftDeferedTranslation();
        return dragResult;
      },
      handleDrop(draggableInfo: DraggableInfo) {
        lastDraggableInfo = null;
        onChildPositionCaptured(false);
        dragHandler = getDragHandler(props);
        dropHandler(draggableInfo, dragResult!);
        dragResult = null;
        parentContainer = null;
        childContainers = [];
      },
      getDragResult() {
        return dragResult;
      },
      getTranslateCalculator(dragresult: { dragResult: DragResult }) {
        return calculateTranslations(props)(dragresult);
      },
      setParentContainer: (container: IContainer) => {
        parentContainer = container;
      },
      getParentContainer: () => parentContainer,
      onTranslated: () => {
        processLastDraggableInfo();
      },
      getOptions: () => props.options,
      setDraggables: () => {
        setDraggables(props.draggables, element);
      },
    };

    return container;
  };
}

// const options: ContainerOptions = {
//   behaviour: 'move',
//   groupName: 'bla bla', // if not defined => container will not interfere with other containers
//   orientation: 'vertical',
//   dragHandleSelector: undefined,
//   nonDragAreaSelector: 'some selector',
//   dragBeginDelay: 0,
//   animationDuration: 180,
//   autoScrollEnabled: true,
//   lockAxis: 'x',
//   dragClass: undefined,
//   dropClass: undefined,
//   onDragStart: (index, payload) => {},
//   onDrop: ({ removedIndex, addedIndex, payload, element }) => {},
//   getChildPayload: index => null,
//   shouldAnimateDrop: (sourceContainerOptions, payload) => true,
//   shouldAcceptDrop: (sourceContainerOptions, payload) => true,
//   onDragEnter: () => {},
//   onDragLeave: () => { },
//   onDropReady: ({ removedIndex, addedIndex, payload, element }) => { },
// };

// exported part of container
const smoothDnD: SmoothDnDCreator & {
  dropHandler?: any;
  wrapChild?: boolean;
} = function(element: ElementX, options: ContainerOptions): SmoothDnD {
  const containerIniter = Container(element);
  const container = containerIniter(options);
  element[containerInstance] = container;
  Mediator.register(container);
  return {
    dispose() {
      Mediator.unregister(container);
      container.layout.dispose();
      container.dispose(container);
    },
  };
};

// wrap all draggables by default 
// in react,vue,angular this value will be set to false
smoothDnD.wrapChild = true;

export default smoothDnD;